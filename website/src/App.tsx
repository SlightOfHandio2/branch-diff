const githubUrl = "https://github.com/SlightOfHandio2/branch-diff";
const releaseUrl = `${githubUrl}/releases`;

const capabilities = [
  {
    title: "Complete branch changes",
    copy: "See committed, staged, unstaged, and untracked files in one list.",
  },
  {
    title: "Useful comparison base",
    copy: "Use the nearest parent branch automatically, or select a different Git ref.",
  },
  {
    title: "Editor markers",
    copy: "See added, modified, and deleted lines in the gutter and overview ruler.",
  },
];

export default function App() {
  return (
    <main id="top">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Branch Diff home">
          <img src="/branch-diff.svg" alt="" />
          <span>Branch Diff</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#install">Install</a>
          <a href={githubUrl}>GitHub</a>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="product-type">VS Code extension</p>
          <h1>See every change on your current branch.</h1>
          <p className="lede">
            Branch Diff compares your branch with its merge base and shows committed work alongside
            staged, unstaged, and untracked changes.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={releaseUrl}>Download VSIX</a>
            <a className="button" href={`${githubUrl}#usage`}>Documentation</a>
          </div>
          <p className="requirement">Requires VS Code 1.95 or later and Git.</p>
        </div>

        <div className="product-window" aria-label="Example of the Branch Diff view">
          <div className="window-title">
            <span>Branch changes</span>
            <span>vs main · Everything</span>
          </div>
          <div className="change-list">
            <div className="change-row"><i className="added">A</i><span>src/lineMapping.ts</span><em>+84 −0</em></div>
            <div className="change-row active"><i className="modified">M</i><span>src/extension.ts</span><em>+26 −9</em></div>
            <div className="change-row"><i className="renamed">R</i><span>src/git.ts</span><em>+12 −4</em></div>
            <div className="change-row"><i className="deleted">D</i><span>src/legacy.ts</span><em>+0 −31</em></div>
          </div>
          <div className="diff-preview" aria-hidden="true">
            <div><span>41</span><code>const base = await resolveBase(root);</code></div>
            <div className="removed"><span>42</span><code>- return diff(root, base);</code></div>
            <div className="inserted"><span>42</span><code>+ return branchDiff(root, base, scope);</code></div>
            <div><span>43</span><code>{"}"}</code></div>
          </div>
        </div>
      </section>

      <section className="features" id="features" aria-labelledby="features-title">
        <div className="section-heading">
          <h2 id="features-title">Features</h2>
          <p>Branch Diff is separate from VS Code’s standard working-tree view.</p>
        </div>
        <div className="feature-list">
          {capabilities.map((capability) => (
            <article key={capability.title}>
              <h3>{capability.title}</h3>
              <p>{capability.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="install" id="install" aria-labelledby="install-title">
        <div className="section-heading">
          <h2 id="install-title">Install</h2>
          <p>Branch Diff starts enabled for Git repositories in the open workspace.</p>
        </div>
        <div className="steps">
          <div><h3>Download</h3><p>Get the latest <code>.vsix</code> from GitHub Releases.</p></div>
          <div><h3>Install</h3><p>In VS Code’s Extensions view, choose <strong>Install from VSIX…</strong></p></div>
          <div><h3>Open</h3><p>Select Branch Diff from the Activity Bar.</p></div>
        </div>
        <div className="install-actions">
          <a className="button button-primary" href={releaseUrl}>View releases</a>
          <a className="text-link" href={`${githubUrl}#usage`}>Usage and configuration →</a>
        </div>
      </section>

      <footer>
        <span>Branch Diff · MIT License</span>
        <div><a href={githubUrl}>Source</a><a href={`${githubUrl}/issues`}>Issues</a></div>
      </footer>
    </main>
  );
}
