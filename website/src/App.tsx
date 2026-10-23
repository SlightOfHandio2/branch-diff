const githubUrl = "https://github.com/SlightOfHandio2/branch-diff";

const features = [
  ["Branch comparison", "Committed, staged, unstaged, and untracked changes in one view."],
  ["Base detection", "Finds the nearest parent branch, with a manual base when you need one."],
  ["Editor markers", "Added, modified, and deleted lines appear in the gutter and overview ruler."],
];

function Logo() {
  return <img className="logo" src="/branch-diff.svg" alt="" aria-hidden="true" />;
}

function ProductView() {
  return (
    <div className="product-view" aria-label="Example of the Branch Diff view">
      <div className="product-bar">
        <span>BRANCH CHANGES</span>
      </div>
      <div className="file-list">
        <div><b>A</b><span>src/lineMapping.ts</span><small>+84 −0</small></div>
        <div className="selected"><b>M</b><span>src/extension.ts</span><small>+26 −9</small></div>
        <div><b>R</b><span>src/git.ts</span><small>+12 −4</small></div>
        <div><b>D</b><span>src/legacy.ts</span><small>+0 −31</small></div>
      </div>
      <div className="code-view">
        <p><i>41</i>const base = await resolveBase(root);</p>
        <p className="removed"><i>42</i>− return diff(root, base);</p>
        <p className="added"><i>42</i>+ return branchDiff(root, base, scope);</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <main id="top">
      <header>
        <a className="wordmark" href="#top" aria-label="Branch Diff home">
          <Logo />
          <span>Branch Diff</span>
        </a>
        <nav className="header-meta" aria-label="Main navigation">
          <a href="#capabilities-title">Features</a>
          <a href={githubUrl}>GitHub ↗</a>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A VS Code extension by Oddiss</p>
          <h1>Review branch changes in VS Code.</h1>
          <p className="intro">
            Branch Diff compares the current branch with its merge base, including committed,
            staged, unstaged, and untracked work.
          </p>
          <div className="actions">
            <a className="primary" href={`${githubUrl}/releases/latest`}>Download extension <span aria-hidden="true">↗</span></a>
            <a href={`${githubUrl}#usage`}>Read the docs <span aria-hidden="true">↗</span></a>
          </div>
          <p className="requirement">VS Code 1.95+ · Git required · Install from VSIX in the Extensions menu</p>
        </div>
        <ProductView />
      </section>

      <section className="capabilities" aria-labelledby="capabilities-title">
        <div className="section-label">
          <h2 id="capabilities-title">A clearer view of your branch.</h2>
        </div>
        <div className="feature-list">
          {features.map(([title, description]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer>
        <span>Branch Diff · MIT licence</span>
        <nav aria-label="Footer"><a href={githubUrl}>Source</a><a href={`${githubUrl}/issues`}>Issues</a></nav>
        <a className="powered-by" href="https://oddiss.com/">Powered by <strong>Oddiss</strong> <span aria-hidden="true">↗</span></a>
      </footer>
    </main>
  );
}
