import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  AutomaticBaseStrategy,
  BranchChange,
  fileAtCommit,
  findRepositoryRoot,
  git,
  listChanges,
  listRefs,
  mergeBase,
  resolveBase
} from './git';

const SCHEME = 'branch-diff';
const CONFIG_SECTION = 'branchDiff';

interface OriginalLocation {
  root: string;
  relativePath: string;
}

class BranchRepository implements vscode.Disposable, vscode.QuickDiffProvider {
  readonly label = 'Branch changes';
  private readonly sourceControl: vscode.SourceControl;
  private readonly changes: vscode.SourceControlResourceGroup;
  private comparisonCommit: string | undefined;
  private baseName: string | undefined;
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
    if (!this.comparisonCommit || !this.isEnabled() || !this.owns(uri)) {
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
      this.updateStatusBar('off');
      this.fireOpenOriginals();
      return;
    }

    try {
      const configured = this.configuration().get<string>('baseBranch', '');
      const strategy = this.configuration().get<AutomaticBaseStrategy>('automaticBaseStrategy', 'nearestAncestor');
      const baseName = await resolveBase(this.root, configured, strategy);
      const comparisonCommit = await mergeBase(this.root, baseName);
      const branchChanges = await listChanges(this.root, comparisonCommit);
      if (this.disposed || generation !== this.refreshGeneration) {
        return;
      }
      this.baseName = baseName;
      this.comparisonCommit = comparisonCommit;
      this.changes.resourceStates = branchChanges.map(change => this.resourceState(change));
      this.updateStatusBar(this.baseName);
      this.fireOpenOriginals();
    } catch (error) {
      if (this.disposed || generation !== this.refreshGeneration) {
        return;
      }
      this.comparisonCommit = undefined;
      this.changes.resourceStates = [];
      this.updateStatusBar('unavailable');
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

  async openChange(uri: vscode.Uri): Promise<void> {
    const original = await this.provideOriginalResource(uri);
    if (!original) {
      return;
    }
    let current = uri;
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      current = makeOriginalUri(this.root, this.relativePath(uri), true);
    }
    const title = `${this.baseName ?? 'base'} ↔ ${path.basename(uri.fsPath)}`;
    await vscode.commands.executeCommand('vscode.diff', original, current, title);
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.sourceControl.dispose();
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
    this.sourceControl.statusBarCommands = [{
      command: 'branchDiff.chooseBase',
      title: `$(git-compare) Base: ${base}`,
      tooltip: 'Choose the branch used by Branch Diff'
    }];
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
      vscode.commands.registerCommand('branchDiff.useAutomaticBase', () => this.setAutomaticBase()),
      vscode.commands.registerCommand('branchDiff.toggle', () => this.toggle()),
      vscode.commands.registerCommand('branchDiff.openChange', (uri: vscode.Uri) => this.repositoryFor(uri)?.openChange(uri)),
      vscode.workspace.onDidSaveTextDocument(document => this.repositoryFor(document.uri)?.scheduleRefresh()),
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

function makeOriginalUri(root: string, relativePath: string, empty = false): vscode.Uri {
  const query = new URLSearchParams({ root });
  if (empty) {
    query.set('empty', '1');
  }
  return vscode.Uri.from({ scheme: SCHEME, path: `/${relativePath}`, query: query.toString() });
}

function parseOriginalUri(uri: vscode.Uri): OriginalLocation | undefined {
  const root = new URLSearchParams(uri.query).get('root');
  if (!root) {
    return undefined;
  }
  return { root, relativePath: uri.path.replace(/^\//, '') };
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
