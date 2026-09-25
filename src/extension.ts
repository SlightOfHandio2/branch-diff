import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { alignLineChanges } from './lineMapping';
import * as vscode from 'vscode';
import {
  AutomaticBaseStrategy,
  addChangeStats,
  BranchChange,
  BranchLineChange,
  DiffScope,
  fileAtCommit,
  fileAtIndex,
  findRepositoryRoot,
  git,
  listChanges,
  listLineChanges,
  listRefs,
  mergeBase,
  pathMatchesPattern,
  resolveBaseDetails
} from './git';

const SCHEME = 'branch-diff';
const CONFIG_SECTION = 'branchDiff';

interface OriginalLocation {
  root: string;
  relativePath: string;
  revision?: 'HEAD' | 'index';
}

type BranchChangeKind = BranchLineChange['kind'];

const DEFAULT_COLORS: Record<BranchChangeKind, string> = {
  added: '#C586C0',
  modified: '#D7BA7D',
  deleted: '#F48771'
};

class BranchRepository implements vscode.Disposable {
  readonly label = 'Branch changes';
  private comparisonCommit: string | undefined;
  private baseName: string | undefined;
  private baseReason: string | undefined;
  private scope: DiffScope = 'all';
  private readonly branchChanges = new Map<string, BranchChange>();
  private decorationTypes: Record<BranchChangeKind, vscode.TextEditorDecorationType> | undefined;
  private decorationColorSignature = '';
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshGeneration = 0;
  private disposed = false;
  private state: 'loading' | 'ready' | 'disabled' | 'error' = 'loading';
  private failure: string | undefined;

  constructor(
    readonly root: string,
    readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly contentChanged: vscode.EventEmitter<vscode.Uri>,
    private readonly treeChanged: () => void
  ) {}

  owns(uri: vscode.Uri): boolean {
    const relative = path.relative(this.root, uri.fsPath);
    return uri.scheme === 'file' && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  hasRoot(uri: vscode.Uri): boolean {
    return uri.scheme === 'file' && path.relative(this.root, uri.fsPath) === '';
  }

  async refresh(showErrors = false): Promise<void> {
    if (this.disposed) {
      return;
    }
    const generation = ++this.refreshGeneration;
    if (!this.isEnabled()) {
      this.state = 'disabled';
      this.failure = undefined;
      this.comparisonCommit = undefined;
      this.branchChanges.clear();
      this.baseName = undefined;
      this.treeChanged();
      this.fireOpenOriginals();
      this.clearVisibleDecorations();
      return;
    }

    try {
      const configured = this.configuration().get<string>('baseBranch', '');
      const strategy = this.configuration().get<AutomaticBaseStrategy>('automaticBaseStrategy', 'nearestAncestor');
      const branchBases = this.configuration().get<Record<string, string>>('branchBases', {});
      const scope = this.configuration().get<DiffScope>('scope', 'all');
      const exclude = this.configuration().get<string[]>('exclude', []);
      const selection = await resolveBaseDetails(this.root, configured, strategy, branchBases);
      const baseName = selection.ref;
      const comparisonCommit = await mergeBase(this.root, baseName);
      const branchChanges = await listChanges(this.root, comparisonCommit, scope, exclude);
      if (branchChanges.length) await addChangeStats(this.root, comparisonCommit, scope, branchChanges);
      if (this.disposed || generation !== this.refreshGeneration) {
        return;
      }
      this.baseName = baseName;
      this.baseReason = selection.reason;
      this.comparisonCommit = comparisonCommit;
      this.scope = scope;
      this.state = 'ready';
      this.failure = undefined;
      this.branchChanges.clear();
      branchChanges.forEach(change => this.branchChanges.set(change.path, change));
      this.treeChanged();
      this.fireOpenOriginals();
      await this.decorateVisibleEditors();
    } catch (error) {
      if (this.disposed || generation !== this.refreshGeneration) {
        return;
      }
      this.comparisonCommit = undefined;
      this.branchChanges.clear();
      this.baseName = undefined;
      this.state = 'error';
      this.failure = error instanceof Error ? error.message : String(error);
      this.treeChanged();
      this.fireOpenOriginals();
      this.clearVisibleDecorations();
      if (showErrors) {
        void vscode.window.showErrorMessage(`Branch Diff: ${errorMessage(error)}`);
      }
    }
  }

  scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => void this.refresh(), 250);
  }

  async originalContent(location: OriginalLocation): Promise<string> {
    if (location.revision === 'HEAD') {
      return fileAtCommit(location.root, 'HEAD', location.relativePath);
    }
    if (location.revision === 'index') {
      return fileAtIndex(location.root, location.relativePath);
    }
    if (!this.comparisonCommit) {
      return '';
    }
    return fileAtCommit(location.root, this.comparisonCommit, location.relativePath);
  }

  async chooseBase(): Promise<void> {
    const refs = await listRefs(this.root);
    const strategy = this.configuration().get<AutomaticBaseStrategy>('automaticBaseStrategy', 'nearestAncestor');
    const automatic = strategy === 'nearestAncestor'
      ? '$(wand) Automatic (nearest parent branch)'
      : '$(wand) Automatic (repository default)';
    const selected = await vscode.window.showQuickPick([automatic, ...refs], {
      title: `Compare ${await currentBranch(this.root)} with…`,
      placeHolder: this.baseName ?? 'Choose a branch or remote branch',
      matchOnDescription: true
    });
    if (!selected) {
      return;
    }
    const value = selected === automatic ? '' : selected;
    await this.configuration().update('baseBranch', value, vscode.ConfigurationTarget.WorkspaceFolder);
    await this.refresh(true);
  }

  async chooseScope(): Promise<void> {
    const choices: Array<vscode.QuickPickItem & { scope: DiffScope }> = [
      {
        label: '$(git-commit) Committed only',
        description: 'Changes committed after the branch split',
        scope: 'committed'
      },
      {
        label: '$(diff-added) Committed + staged',
        description: 'Committed changes plus the current Git index',
        scope: 'staged'
      },
      {
        label: '$(workspace-trusted) Everything',
        description: 'Committed, staged, unstaged, and untracked changes',
        scope: 'all'
      }
    ];
    const selected = await vscode.window.showQuickPick(choices, {
      title: 'Branch Diff: choose which changes to include',
      placeHolder: `Current scope: ${scopeLabel(this.scope)}`
    });
    if (!selected) {
      return;
    }
    await this.configuration().update('scope', selected.scope, vscode.ConfigurationTarget.WorkspaceFolder);
    await this.refresh(true);
  }

  async openChange(uri: vscode.Uri): Promise<void> {
    if (!this.comparisonCommit || !this.isEnabled() || !this.owns(uri)) {
      return;
    }
    const change = this.branchChanges.get(this.relativePath(uri));
    const original = makeOriginalUri(this.root, change?.originalPath ?? this.relativePath(uri));
    let current: vscode.Uri;
    if (this.scope === 'committed') {
      current = makeOriginalUri(this.root, this.relativePath(uri), false, 'HEAD');
    } else if (this.scope === 'staged') {
      current = makeOriginalUri(this.root, this.relativePath(uri), false, 'index');
    } else {
      current = uri;
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        current = makeOriginalUri(this.root, this.relativePath(uri), true);
      }
    }
    const title = `${this.baseName ?? 'base'} ↔ ${path.basename(uri.fsPath)} (${scopeLabel(this.scope)})`;
    await vscode.commands.executeCommand('vscode.diff', original, current, title);
  }

  async decorate(editor: vscode.TextEditor): Promise<void> {
    if (!this.owns(editor.document.uri) || !this.isEnabled() || !this.comparisonCommit) {
      return;
    }
    const types = this.ensureDecorationTypes();
    const relativePath = this.relativePath(editor.document.uri);
    const change = this.branchChanges.get(relativePath);
    if (!change) {
      this.clearDecorations(editor, types);
      return;
    }

    const comparisonCommit = this.comparisonCommit;
    const scope = this.scope;
    const generation = this.refreshGeneration;
    const version = editor.document.version;
    let lineChanges: BranchLineChange[];
    if (change.status === '?' || (change.status === 'A' && scope === 'all')) {
      lineChanges = [{ startLine: 1, lineCount: editor.document.lineCount, kind: 'added' }];
    } else {
      lineChanges = await listLineChanges(this.root, comparisonCommit, relativePath, scope, change.originalPath);
      const source = scope === 'committed'
        ? await fileAtCommit(this.root, 'HEAD', relativePath)
        : scope === 'staged' ? await fileAtIndex(this.root, relativePath)
        : await readFile(editor.document.uri.fsPath, 'utf8');
      lineChanges = await alignLineChanges(lineChanges, source, editor.document.getText());
    }
    if (this.disposed || !this.isEnabled() || generation !== this.refreshGeneration
      || version !== editor.document.version || comparisonCommit !== this.comparisonCommit || scope !== this.scope) {
      return;
    }

    const ranges: Record<BranchChangeKind, vscode.Range[]> = { added: [], modified: [], deleted: [] };
    for (const lineChange of lineChanges) {
      const start = Math.min(editor.document.lineCount - 1, Math.max(0, lineChange.startLine - 1));
      const end = Math.min(editor.document.lineCount - 1, start + lineChange.lineCount - 1);
      ranges[lineChange.kind].push(new vscode.Range(start, 0, end, editor.document.lineAt(end).range.end.character));
    }
    for (const kind of Object.keys(ranges) as BranchChangeKind[]) {
      editor.setDecorations(types[kind], ranges[kind]);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    Object.values(this.decorationTypes ?? {}).forEach(type => type.dispose());
  }

  get changes(): readonly BranchChange[] {
    return [...this.branchChanges.values()];
  }

  get comparisonLabel(): string {
    return this.baseName ?? (this.isEnabled() ? 'unavailable' : 'off');
  }

  get scopeLabel(): string {
    return scopeLabel(this.scope);
  }

  documentChanged(): void {
    this.refreshGeneration++;
    // Remove stale markers immediately; recompute after typing settles.
    this.clearVisibleDecorations();
    this.scheduleRefresh();
  }

  get baseExplanation(): string {
    if (!this.comparisonCommit) return this.description;
    return `Comparison base: ${this.comparisonLabel}\n${this.baseReason}\nComparing from merge-base ${this.comparisonCommit}.\nScope: ${this.scopeLabel}. The comparison starts at the shared ancestor, not necessarily the base branch's latest commit.`;
  }

  get baseSummary(): string | undefined {
    return this.comparisonCommit
      ? `${this.comparisonLabel} • ${this.comparisonCommit.slice(0, 8)}` : undefined;
  }

  get description(): string {
    if (this.state === 'loading') return 'Loading comparison…';
    if (this.state === 'disabled') return 'Disabled';
    if (this.state === 'error') return 'Comparison failed';
    return `vs ${this.comparisonLabel} • ${this.scopeLabel} • ${changeTotals(this.changes)}`;
  }

  get emptyRows(): StateRow[] {
    if (this.state === 'loading') {
      return [{ label: 'Loading branch comparison…', icon: 'loading~spin' }];
    }
    if (this.state === 'disabled') {
      return [{ label: 'Branch Diff is disabled', icon: 'circle-slash' },
        { label: 'Enable Branch Diff', icon: 'play', action: 'enable' }];
    }
    if (this.state === 'error') {
      return [{ label: 'Could not compare this branch', icon: 'warning', detail: this.failure },
        { label: 'Retry comparison', icon: 'refresh', action: 'retry' },
        { label: 'Choose comparison branch…', icon: 'git-branch', action: 'base' }];
    }
    return [{ label: 'No changes in this comparison', icon: 'check',
      detail: `No files to show against ${this.comparisonLabel} (${this.scopeLabel}), after exclusions. When comparing with the current branch, committed changes are empty; staged and working-tree changes still follow the selected scope.` },
      { label: 'Choose comparison branch…', icon: 'git-branch', action: 'base' },
      { label: 'Choose diff scope…', icon: 'filter', action: 'scope' }];
  }

  async enable(): Promise<void> {
    await this.configuration().update('enabled', true, vscode.ConfigurationTarget.WorkspaceFolder);
    await this.refresh(true);
  }

  uriFor(change: BranchChange): vscode.Uri {
    return vscode.Uri.file(path.join(this.root, ...change.path.split('/')));
  }

  private ensureDecorationTypes(): Record<BranchChangeKind, vscode.TextEditorDecorationType> {
    const configured = this.configuration().get<Partial<Record<BranchChangeKind, string>>>('colors', {});
    const colors = { ...DEFAULT_COLORS, ...configured };
    const signature = JSON.stringify(colors);
    if (this.decorationTypes && signature === this.decorationColorSignature) {
      return this.decorationTypes;
    }
    Object.values(this.decorationTypes ?? {}).forEach(type => type.dispose());
    this.decorationColorSignature = signature;
    this.decorationTypes = {
      added: this.createDecorationType('added', colors.added),
      modified: this.createDecorationType('modified', colors.modified),
      deleted: this.createDecorationType('deleted', colors.deleted)
    };
    return this.decorationTypes;
  }

  private createDecorationType(kind: BranchChangeKind, color: string): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      gutterIconPath: branchMarkerUri(kind, color),
      gutterIconSize: '50%',
      overviewRulerColor: color,
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
  }

  private async decorateVisibleEditors(): Promise<void> {
    await Promise.all(vscode.window.visibleTextEditors.map(editor => this.decorate(editor)));
  }

  private clearVisibleDecorations(): void {
    if (!this.decorationTypes) {
      return;
    }
    vscode.window.visibleTextEditors.forEach(editor => this.clearDecorations(editor, this.decorationTypes!));
  }

  private clearDecorations(
    editor: vscode.TextEditor,
    types: Record<BranchChangeKind, vscode.TextEditorDecorationType>
  ): void {
    Object.values(types).forEach(type => editor.setDecorations(type, []));
  }

  private relativePath(uri: vscode.Uri): string {
    return path.relative(this.root, uri.fsPath).split(path.sep).join('/');
  }

  private configuration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION, this.workspaceFolder.uri);
  }

  private isEnabled(): boolean {
    return this.configuration().get<boolean>('enabled', true);
  }

  private isExcluded(relativePath: string): boolean {
    return this.configuration().get<string[]>('exclude', [])
      .some(pattern => pathMatchesPattern(relativePath, pattern));
  }

  private fireOpenOriginals(): void {
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === SCHEME) {
        const location = parseOriginalUri(document.uri);
        if (location?.root === this.root) {
          this.contentChanged.fire(document.uri);
        }
      }
    }
  }
}

interface StateRow {
  label: string;
  icon: string;
  detail?: string;
  action?: 'enable' | 'retry' | 'base' | 'scope' | 'openFolder';
}

type BranchDiffTreeElement =
  | { kind: 'comparison'; repository: BranchRepository }
  | { kind: 'folder'; repository: BranchRepository; folder: string }
  | { kind: 'state'; repository?: BranchRepository; row: StateRow }
  | { kind: 'repository'; repository: BranchRepository }
  | { kind: 'change'; repository: BranchRepository; change: BranchChange };

class BranchDiffTreeProvider implements vscode.TreeDataProvider<BranchDiffTreeElement>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<BranchDiffTreeElement | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly repositories: readonly BranchRepository[]) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(element: BranchDiffTreeElement): vscode.TreeItem {
    if (element.kind === 'comparison') {
      const item = new vscode.TreeItem('Comparison base', vscode.TreeItemCollapsibleState.None);
      item.description = element.repository.baseSummary;
      item.tooltip = element.repository.baseExplanation;
      item.iconPath = new vscode.ThemeIcon('git-branch');
      item.command = { command: 'branchDiff.stateAction', title: 'Choose comparison branch',
        arguments: [{ kind: 'state', repository: element.repository,
          row: { label: 'Choose comparison branch', icon: 'git-branch', action: 'base' } }] };
      return item;
    }
    if (element.kind === 'folder') {
      const item = new vscode.TreeItem(path.posix.basename(element.folder), vscode.TreeItemCollapsibleState.Expanded);
      item.id = `${element.repository.root}:folder:${element.folder}`;
      item.iconPath = new vscode.ThemeIcon('folder');
      item.description = changeTotals(element.repository.changes.filter(change => change.path.startsWith(`${element.folder}/`)));
      return item;
    }
    if (element.kind === 'state') {
      const item = new vscode.TreeItem(element.row.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(element.row.icon);
      item.tooltip = element.row.detail ?? element.row.label;
      if (element.row.action) {
        item.command = { command: 'branchDiff.stateAction', title: element.row.label, arguments: [element] };
      }
      return item;
    }
    if (element.kind === 'repository') {
      const item = new vscode.TreeItem(
        path.basename(element.repository.root),
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = element.repository.description;
      item.tooltip = element.repository.baseExplanation;
      item.iconPath = new vscode.ThemeIcon('repo', new vscode.ThemeColor('branchDiff.accent'));
      item.contextValue = 'branchDiff.repository';
      return item;
    }

    const { repository, change } = element;
    const uri = repository.uriFor(change);
    const item = new vscode.TreeItem(change.originalPath
      ? `${change.originalPath} → ${change.path}`
      : path.basename(change.path), vscode.TreeItemCollapsibleState.None);
    const parent = path.posix.dirname(change.path);
    item.description = `${this.layout === 'flat' && parent !== '.' ? `${parent} • ` : ''}${statusLabel(change.status).toUpperCase()} • ${statsLabel(change)}`;
    item.tooltip = new vscode.MarkdownString(
      `**Branch comparison**  \n${change.originalPath ? `${change.originalPath} → ` : ''}${change.path}  \n${statusLabel(change.status)} relative to **${repository.comparisonLabel}**`
    );
    item.iconPath = new vscode.ThemeIcon(statusIcon(change.status), new vscode.ThemeColor(statusColor(change.status)));
    item.command = {
      command: 'branchDiff.openChange',
      title: 'Open branch comparison',
      arguments: [uri]
    };
    item.contextValue = 'branchDiff.change';
    return item;
  }

  getChildren(element?: BranchDiffTreeElement): BranchDiffTreeElement[] {
    if (element?.kind === 'folder') return this.folderChildren(element.repository, element.folder);
    if (element?.kind === 'change' || element?.kind === 'state' || element?.kind === 'comparison') {
      return [];
    }
    if (element?.kind === 'repository') {
      return this.repositoryChildren(element.repository);
    }
    if (this.repositories.length === 1) {
      const repository = this.repositories[0];
      return this.repositoryChildren(repository);
    }
    if (this.repositories.length === 0) {
      return [
        { kind: 'state', row: { label: 'No Git repository found', icon: 'info',
          detail: 'Open a folder containing a Git repository. Git must be installed and available on your system path.' } },
        { kind: 'state', row: { label: 'Open repository folder…', icon: 'folder-opened', action: 'openFolder' } }
      ];
    }
    return this.repositories.map(repository => ({ kind: 'repository', repository }));
  }

  private repositoryChildren(repository: BranchRepository): BranchDiffTreeElement[] {
    const children: BranchDiffTreeElement[] = repository.changes.length
      ? this.layout === 'tree' ? this.folderChildren(repository, '')
        : repository.changes.map(change => ({ kind: 'change', repository, change }))
      : repository.emptyRows.map(row => ({ kind: 'state', repository, row }));
    return repository.baseSummary ? [{ kind: 'comparison', repository }, ...children] : children;
  }

  private get layout(): string {
    return vscode.workspace.getConfiguration(CONFIG_SECTION).get('viewLayout', 'flat');
  }

  private folderChildren(repository: BranchRepository, folder: string): BranchDiffTreeElement[] {
    const prefix = folder ? `${folder}/` : '';
    const folders = new Set<string>();
    const files: BranchDiffTreeElement[] = [];
    for (const change of repository.changes) {
      if (!change.path.startsWith(prefix)) continue;
      const remaining = change.path.slice(prefix.length);
      const slash = remaining.indexOf('/');
      if (slash >= 0) folders.add(prefix + remaining.slice(0, slash));
      else files.push({ kind: 'change', repository, change });
    }
    return [...[...folders].sort().map(folder => ({ kind: 'folder' as const, repository, folder })), ...files];
  }

  dispose(): void {
    this.changed.dispose();
  }
}

class BranchDiffController implements vscode.Disposable, vscode.TextDocumentContentProvider {
  private readonly repositories: BranchRepository[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly contentChanged = new vscode.EventEmitter<vscode.Uri>();
  private readonly treeProvider = new BranchDiffTreeProvider(this.repositories);
  private treeView: vscode.TreeView<BranchDiffTreeElement> | undefined;
  readonly onDidChange = this.contentChanged.event;

  async start(context: vscode.ExtensionContext): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = await findRepositoryRoot(folder.uri.fsPath);
      if (root && !this.repositories.some(repository => repository.root === root)) {
        this.repositories.push(new BranchRepository(root, folder, this.contentChanged, () => this.updateTree()));
      }
    }

    this.treeView = vscode.window.createTreeView('branchDiff.changes', {
      treeDataProvider: this.treeProvider,
      showCollapseAll: true
    });
    this.treeView.message = 'Branch comparison — separate from uncommitted Git changes';

    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
      this.treeView,
      vscode.commands.registerCommand('branchDiff.toggleLayout', async () => {
        const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
        await configuration.update('viewLayout', configuration.get('viewLayout', 'flat') === 'flat' ? 'tree' : 'flat',
          vscode.ConfigurationTarget.Workspace);
      }),
      vscode.commands.registerCommand('branchDiff.stateAction', async (element: BranchDiffTreeElement) => {
        if (element.kind !== 'state') return;
        const repository = element.repository;
        try {
          switch (element.row.action) {
            case 'openFolder': await vscode.commands.executeCommand('vscode.openFolder'); break;
            case 'enable': await repository?.enable(); break;
            case 'retry': await repository?.refresh(true); break;
            case 'base': await repository?.chooseBase(); break;
            case 'scope': await repository?.chooseScope(); break;
          }
        } catch (error) {
          void vscode.window.showErrorMessage(`Branch Diff: ${errorMessage(error)}`);
        }
      }),
      vscode.commands.registerCommand('branchDiff.refresh', () => this.forSelected(repository => repository.refresh(true))),
      vscode.commands.registerCommand('branchDiff.chooseBase', () => this.forSelected(repository => repository.chooseBase())),
      vscode.commands.registerCommand('branchDiff.chooseScope', () => this.forSelected(repository => repository.chooseScope())),
      vscode.commands.registerCommand('branchDiff.useAutomaticBase', () => this.setAutomaticBase()),
      vscode.commands.registerCommand('branchDiff.toggle', () => this.toggle()),
      vscode.commands.registerCommand('branchDiff.openChange', (uri: vscode.Uri) => this.repositoryFor(uri)?.openChange(uri)),
      vscode.workspace.onDidSaveTextDocument(document => this.repositoryFor(document.uri)?.scheduleRefresh()),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.contentChanges.length) this.repositoryFor(event.document.uri)?.documentChanged();
      }),
      vscode.window.onDidChangeVisibleTextEditors(editors => {
        for (const editor of editors) {
          void this.repositoryFor(editor.document.uri)?.decorate(editor);
        }
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(CONFIG_SECTION)) {
          void this.refreshAll();
        }
      }),
      vscode.window.onDidChangeWindowState(state => {
        if (state.focused) {
          void this.refreshAll();
        }
      })
    );
    context.subscriptions.push(this);
    this.updateTree();
    await this.refreshAll();
    await this.listenToBuiltInGit();
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const location = parseOriginalUri(uri);
    if (!location) {
      return '';
    }
    if (new URLSearchParams(uri.query).get('empty') === '1') {
      return '';
    }
    return this.repositories.find(repository => repository.root === location.root)?.originalContent(location) ?? '';
  }

  dispose(): void {
    this.repositories.forEach(repository => repository.dispose());
    this.disposables.forEach(disposable => disposable.dispose());
    this.treeProvider.dispose();
    this.contentChanged.dispose();
  }

  private repositoryFor(uri?: vscode.Uri): BranchRepository | undefined {
    if (!uri) {
      uri = vscode.window.activeTextEditor?.document.uri;
    }
    return uri ? this.repositories.find(repository => repository.owns(uri)) : undefined;
  }

  private selectedTreeRepository(): BranchRepository | undefined {
    const selected = this.treeView?.selection[0];
    return selected?.repository;
  }

  private async forSelected(action: (repository: BranchRepository) => Promise<void>): Promise<void> {
    const repository = this.selectedTreeRepository() ?? this.repositoryFor();
    if (repository) {
      await action(repository);
    } else if (this.repositories.length === 1) {
      await action(this.repositories[0]);
    } else if (this.repositories.length === 0) {
      void vscode.window.showInformationMessage('Branch Diff: no Git repository found in this workspace.');
    }
  }

  private async refreshAll(): Promise<void> {
    await Promise.all(this.repositories.map(repository => repository.refresh()));
  }

  private updateTree(): void {
    this.treeProvider.refresh();
    if (!this.treeView) {
      return;
    }
    if (this.repositories.length === 1) {
      const repository = this.repositories[0];
      this.treeView.description = repository.description;
      this.treeView.badge = repository.changes.length
        ? { value: repository.changes.length, tooltip: 'Files changed on this branch' }
        : undefined;
    } else {
      const changeCount = this.repositories.reduce((total, repository) => total + repository.changes.length, 0);
      this.treeView.description = `${this.repositories.length} repositories • ${changeTotals(this.repositories.flatMap(repository => [...repository.changes]))}`;
      this.treeView.badge = changeCount
        ? { value: changeCount, tooltip: 'Files changed across branches' }
        : undefined;
    }
  }

  private async setAutomaticBase(): Promise<void> {
    await this.forSelected(async repository => {
      await vscode.workspace.getConfiguration(CONFIG_SECTION, repository.workspaceFolder.uri)
        .update('baseBranch', '', vscode.ConfigurationTarget.WorkspaceFolder);
      await repository.refresh(true);
    });
  }

  private async toggle(): Promise<void> {
    const repository = this.selectedTreeRepository()
      ?? this.repositoryFor()
      ?? (this.repositories.length === 1 ? this.repositories[0] : undefined);
    if (!repository) {
      return;
    }
    const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION, repository.workspaceFolder.uri);
    await configuration.update('enabled', !configuration.get<boolean>('enabled', true), vscode.ConfigurationTarget.WorkspaceFolder);
  }

  private async listenToBuiltInGit(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!extension) {
      return;
    }
    try {
      const api = (await extension.activate()).getAPI(1);
      const attach = (repository: GitRepository) => {
        const branchRepository = this.repositories.find(candidate => candidate.hasRoot(repository.rootUri));
        if (!branchRepository) {
          return;
        }
        const disposable = repository.state.onDidChange(() => branchRepository.scheduleRefresh());
        this.disposables.push(disposable);
      };
      api.repositories.forEach(attach);
      this.disposables.push(api.onDidOpenRepository(attach));
    } catch {
      // Focus changes, saves, and the manual command remain as refresh fallbacks.
    }
  }
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: { onDidChange: vscode.Event<void> };
}

interface GitExtension {
  getAPI(version: 1): {
    repositories: GitRepository[];
    onDidOpenRepository: vscode.Event<GitRepository>;
  };
}

function makeOriginalUri(
  root: string,
  relativePath: string,
  empty = false,
  revision?: OriginalLocation['revision']
): vscode.Uri {
  const query = new URLSearchParams({ root });
  if (empty) {
    query.set('empty', '1');
  }
  if (revision) {
    query.set('revision', revision);
  }
  return vscode.Uri.from({ scheme: SCHEME, path: `/${relativePath}`, query: query.toString() });
}

function parseOriginalUri(uri: vscode.Uri): OriginalLocation | undefined {
  const root = new URLSearchParams(uri.query).get('root');
  if (!root) {
    return undefined;
  }
  const revision = new URLSearchParams(uri.query).get('revision');
  return {
    root,
    relativePath: uri.path.replace(/^\//, ''),
    revision: revision === 'HEAD' || revision === 'index' ? revision : undefined
  };
}

function statsLabel(change: BranchChange): string {
  return change.stats === 'binary' ? 'Binary' : change.stats
    ? `+${change.stats.added} −${change.stats.deleted}` : 'Stats unavailable';
}

function changeTotals(changes: readonly BranchChange[]): string {
  let added = 0, deleted = 0, binary = 0, unavailable = 0;
  for (const change of changes) {
    if (change.stats === 'binary') binary++;
    else if (change.stats) { added += change.stats.added; deleted += change.stats.deleted; }
    else unavailable++;
  }
  return `${changes.length} ${changes.length === 1 ? 'file' : 'files'} • +${added} −${deleted}`
    + (binary ? ` • ${binary} binary` : '') + (unavailable ? ` • ${unavailable} unavailable` : '');
}

function scopeLabel(scope: DiffScope): string {
  return ({ committed: 'Committed only', staged: 'Committed + staged', all: 'Everything' })[scope];
}

function statusLabel(status: string): string {
  return ({ A: 'Added on branch', D: 'Deleted on branch', M: 'Modified on branch', R: 'Renamed on branch', '?': 'Untracked' } as Record<string, string>)[status] ?? 'Changed on branch';
}

function statusIcon(status: string): string {
  return ({ A: 'diff-added', D: 'diff-removed', M: 'diff-modified', R: 'diff-renamed', '?': 'new-file' } as Record<string, string>)[status]
    ?? 'diff';
}

function statusColor(status: string): string {
  return ({ A: 'branchDiff.added', D: 'branchDiff.deleted', M: 'branchDiff.modified', R: 'branchDiff.modified', '?': 'branchDiff.added' } as Record<string, string>)[status]
    ?? 'branchDiff.accent';
}

function branchMarkerUri(kind: BranchChangeKind, color: string): vscode.Uri {
  const shape = {
    added: '<path d="M6 1 11 6 6 11 1 6Z"/>',
    modified: '<circle cx="6" cy="6" r="4.25" fill="none" stroke-width="2.5"/>',
    deleted: '<path d="M1 4.5h10v3H1z"/>'
  }[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="${color}" stroke="${color}">${shape}</svg>`;
  return vscode.Uri.parse(`data:image/svg+xml,${encodeURIComponent(svg)}`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split('\n')[0];
  }
  return String(error);
}

async function currentBranch(root: string): Promise<string> {
  return git(root, ['branch', '--show-current']).then(branch => branch.trim() || 'HEAD').catch(() => 'current branch');
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const controller = new BranchDiffController();
  await controller.start(context);
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered on the extension context.
}
