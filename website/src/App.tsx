const githubUrl = "https://github.com/SlightOfHandio2/branch-diff";

const features = [
  ["Branch comparison", "Committed, staged, unstaged, and untracked changes in one view."],
  ["Base detection", "Finds the nearest parent branch, with a manual base when you need one."],
  ["Editor markers", "Added, modified, and deleted lines appear in the gutter and overview ruler."],
];

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 42 42" aria-hidden="true">
      <circle cx="11" cy="9" r="5" />
      <path d="M11 14v3c0 4 3 7 7 7h6c4 0 7 3 7 7v2" />
      <circle cx="31" cy="34" r="5" />
      <path d="M28 5h10M33 0v10" />
    </svg>
  );
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
          <span>BRANCH DIFF</span>
        </a>
        <div className="header-meta"><span>VS CODE EXTENSION</span><a href={githubUrl}>GITHUB ↗</a></div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>Review branch changes in VS Code.</h1>
          <p className="intro">
            Branch Diff compares the current branch with its merge base, including committed,
            staged, unstaged, and untracked work.
          </p>
          <div className="actions">
            <a className="primary" href={githubUrl}>VIEW SOURCE <span>↗</span></a>
            <a href={`${githubUrl}#usage`}>READ THE DOCS <span>↗</span></a>
          </div>
          <p className="requirement">VS CODE 1.95+ / GIT REQUIRED</p>
        </div>
        <ProductView />
      </section>

      <section className="capabilities" aria-labelledby="capabilities-title">
        <div className="section-label">
          <h2 id="capabilities-title">Features.</h2>
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
        <span>BRANCH DIFF / MIT</span>
        <nav aria-label="Footer"><a href={githubUrl}>SOURCE</a><a href={`${githubUrl}/issues`}>ISSUES</a></nav>
      </footer>
    </main>
  );
}
