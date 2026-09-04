import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  AutomaticBaseStrategy,
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
  resolveBase
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

class BranchRepository implements vscode.Disposable, vscode.QuickDiffProvider {
  readonly label = 'Branch changes';
  private readonly sourceControl: vscode.SourceControl;
  private readonly changes: vscode.SourceControlResourceGroup;
  private comparisonCommit: string | undefined;
  private baseName: string | undefined;
  private scope: DiffScope = 'all';
  private readonly branchChanges = new Map<string, BranchChange>();
  private decorationTypes: Record<BranchChangeKind, vscode.TextEditorDecorationType> | undefined;
  private decorationColorSignature = '';
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshGeneration = 0;
  private disposed = false;

  constructor(
    readonly root: string,
    readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly contentChanged: vscode.EventEmitter<vscode.Uri>
  ) {
    this.sourceControl = vscode.scm.createSourceControl(
      'branchDiff',
      `Branch Changes — ${path.basename(root)}`,
      vscode.Uri.file(root)
    );
    this.sourceControl.inputBox.visible = false;
    this.changes = this.sourceControl.createResourceGroup('branchChanges', 'Changes from base');
    this.sourceControl.quickDiffProvider = this;
  }

  owns(uri: vscode.Uri): boolean {
    const relative = path.relative(this.root, uri.fsPath);
    return uri.scheme === 'file' && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  hasRoot(uri: vscode.Uri): boolean {
    return uri.scheme === 'file' && path.relative(this.root, uri.fsPath) === '';
  }

  async provideOriginalResource(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (!this.comparisonCommit || this.scope !== 'all' || !this.isEnabled() || !this.owns(uri)) {
      return undefined;
    }
    const relativePath = this.relativePath(uri);
    if (relativePath.startsWith('.git/')) {
      return undefined;
    }
    return makeOriginalUri(this.root, relativePath);
  }

  async refresh(showErrors = false): Promise<void> {
    if (this.disposed) {
      return;
    }
    const generation = ++this.refreshGeneration;
    if (!this.isEnabled()) {
      this.comparisonCommit = undefined;
      this.changes.resourceStates = [];
      this.branchChanges.clear();
      this.sourceControl.quickDiffProvider = undefined;
      this.updateStatusBar('off');
      this.fireOpenOriginals();
      this.clearVisibleDecorations();
      return;
    }

    try {
      const configured = this.configuration().get<string>('baseBranch', '');
      const strategy = this.configuration().get<AutomaticBaseStrategy>('automaticBaseStrategy', 'nearestAncestor');
      const branchBases = this.configuration().get<Record<string, string>>('branchBases', {});
      const scope = this.configuration().get<DiffScope>('scope', 'all');
      const baseName = await resolveBase(this.root, configured, strategy, branchBases);
      const comparisonCommit = await mergeBase(this.root, baseName);
      const branchChanges = await listChanges(this.root, comparisonCommit, scope);
      if (this.disposed || generation !== this.refreshGeneration) {
        return;
      }
      this.baseName = baseName;
      this.comparisonCommit = comparisonCommit;
      this.scope = scope;
      this.sourceControl.quickDiffProvider = scope === 'all' ? this : undefined;
      this.branchChanges.clear();
      branchChanges.forEach(change => this.branchChanges.set(change.path, change));
      this.changes.resourceStates = branchChanges.map(change => this.resourceState(change));
      this.updateStatusBar(this.baseName);
      this.fireOpenOriginals();
      await this.decorateVisibleEditors();
    } catch (error) {
      if (this.disposed || generation !== this.refreshGeneration) {
        return;
      }
      this.comparisonCommit = undefined;
      this.changes.resourceStates = [];
      this.branchChanges.clear();
      this.sourceControl.quickDiffProvider = undefined;
      this.updateStatusBar('unavailable');
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
    const original = makeOriginalUri(this.root, this.relativePath(uri));
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
    let lineChanges: BranchLineChange[];
    if (change.status === '?' || (change.status === 'A' && scope === 'all')) {
      lineChanges = [{ startLine: 1, lineCount: editor.document.lineCount, kind: 'added' }];
    } else {
      lineChanges = await listLineChanges(this.root, comparisonCommit, relativePath, scope);
    }
    if (this.disposed || comparisonCommit !== this.comparisonCommit || scope !== this.scope) {
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
    this.sourceControl.dispose();
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
      added: this.createDecorationType(colors.added),
      modified: this.createDecorationType(colors.modified),
      deleted: this.createDecorationType(colors.deleted)
    };
    return this.decorationTypes;
  }

  private createDecorationType(color: string): vscode.TextEditorDecorationType {
    return vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderColor: color,
      borderStyle: 'solid',
      borderWidth: '0 0 0 3px',
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

  private resourceState(change: BranchChange): vscode.SourceControlResourceState {
    const uri = vscode.Uri.file(path.join(this.root, ...change.path.split('/')));
    const label = statusLabel(change.status);
    return {
      resourceUri: uri,
      command: {
        command: 'branchDiff.openChange',
        title: 'Open branch change',
        arguments: [uri]
      },
      decorations: {
        tooltip: label,
        strikeThrough: change.status === 'D',
        faded: change.status === 'D'
      }
    };
  }

  private updateStatusBar(base: string): void {
    this.sourceControl.statusBarCommands = [
      {
        command: 'branchDiff.chooseBase',
        title: `$(git-compare) Base: ${base}`,
        tooltip: 'Choose the branch used by Branch Diff'
      },
      {
        command: 'branchDiff.chooseScope',
        title: `$(filter) ${scopeLabel(this.scope)}`,
        tooltip: 'Choose which changes Branch Diff includes'
      }
    ];
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

class BranchDiffController implements vscode.Disposable, vscode.TextDocumentContentProvider {
  private readonly repositories: BranchRepository[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly contentChanged = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.contentChanged.event;

  async start(context: vscode.ExtensionContext): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = await findRepositoryRoot(folder.uri.fsPath);
      if (root && !this.repositories.some(repository => repository.root === root)) {
        this.repositories.push(new BranchRepository(root, folder, this.contentChanged));
      }
    }

    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
      vscode.commands.registerCommand('branchDiff.refresh', () => this.forSelected(repository => repository.refresh(true))),
      vscode.commands.registerCommand('branchDiff.chooseBase', () => this.forSelected(repository => repository.chooseBase())),
      vscode.commands.registerCommand('branchDiff.chooseScope', () => this.forSelected(repository => repository.chooseScope())),
      vscode.commands.registerCommand('branchDiff.useAutomaticBase', () => this.setAutomaticBase()),
      vscode.commands.registerCommand('branchDiff.toggle', () => this.toggle()),
      vscode.commands.registerCommand('branchDiff.openChange', (uri: vscode.Uri) => this.repositoryFor(uri)?.openChange(uri)),
      vscode.workspace.onDidSaveTextDocument(document => this.repositoryFor(document.uri)?.scheduleRefresh()),
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
    this.contentChanged.dispose();
  }

  private repositoryFor(uri?: vscode.Uri): BranchRepository | undefined {
    if (!uri) {
      uri = vscode.window.activeTextEditor?.document.uri;
    }
    return uri ? this.repositories.find(repository => repository.owns(uri)) : undefined;
  }

  private async forSelected(action: (repository: BranchRepository) => Promise<void>): Promise<void> {
    const repository = this.repositoryFor();
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

  private async setAutomaticBase(): Promise<void> {
    await this.forSelected(async repository => {
      await vscode.workspace.getConfiguration(CONFIG_SECTION, repository.workspaceFolder.uri)
        .update('baseBranch', '', vscode.ConfigurationTarget.WorkspaceFolder);
      await repository.refresh(true);
    });
  }

  private async toggle(): Promise<void> {
    const repository = this.repositoryFor() ?? (this.repositories.length === 1 ? this.repositories[0] : undefined);
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

function scopeLabel(scope: DiffScope): string {
  return ({ committed: 'Committed only', staged: 'Committed + staged', all: 'Everything' })[scope];
}

function statusLabel(status: string): string {
  return ({ A: 'Added on branch', D: 'Deleted on branch', M: 'Modified on branch', '?': 'Untracked' } as Record<string, string>)[status] ?? 'Changed on branch';
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
