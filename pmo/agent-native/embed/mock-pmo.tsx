/**
 * Mock PMO-style host layout — Step 4 coexistence pilot.
 *
 * This is intentionally NOT real PMO code. It mimics the shell shape that
 * matters for the coexistence question: a fixed left nav + a scrolling main
 * content area, laid out with plain CSS (no PMO dep, no Tailwind). The real
 * integration point in `pmo-portal/` is `App.tsx`'s `assistant` slot — a
 * `position: fixed` overlay outside the grid, per exploration — so this mock
 * transfers: if `<AgentSidebar>` can wrap THIS without reflowing it, it can
 * wrap the real shell the same way.
 */
import React from "react";

const NAV_ITEMS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Dashboard", href: "#" },
  { label: "Companies", href: "#" },
  { label: "Contacts", href: "#" },
  { label: "Projects", href: "#" },
  { label: "Activities", href: "#" },
  { label: "Reports", href: "#" },
  { label: "Settings", href: "#" },
];

export function MockPmoShell(): React.JSX.Element {
  return (
    <div className="pmo-shell">
      <aside className="pmo-nav">
        <div className="pmo-nav__brand">
          <span className="pmo-nav__logo">◆</span>
          <span className="pmo-nav__title">PMO</span>
        </div>
        <nav className="pmo-nav__list">
          {NAV_ITEMS.map((item) => (
            <a key={item.label} className="pmo-nav__item" href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="pmo-nav__footer">pilot · mock shell</div>
      </aside>

      <main className="pmo-main">
        <header className="pmo-main__header">
          <h1>Dashboard</h1>
          <p className="pmo-main__sub">
            Mock host content — verifying the agent panel coexists with this
            layout instead of capturing it.
          </p>
        </header>

        <section className="pmo-cards">
          <article className="pmo-card">
            <span className="pmo-card__label">Open Companies</span>
            <span className="pmo-card__value">24</span>
          </article>
          <article className="pmo-card">
            <span className="pmo-card__label">Active Projects</span>
            <span className="pmo-card__value">7</span>
          </article>
          <article className="pmo-card">
            <span className="pmo-card__label">Activities · 7d</span>
            <span className="pmo-card__value">132</span>
          </article>
        </section>

        <section className="pmo-prose">
          <h2>Coexistence probe</h2>
          <p>
            This content lives in the host shell. With the agent sidebar open on
            the right, the left nav and this main area should stay fully laid
            out, scrollable, and clickable. The sidebar is expected to be a
            <code>position: fixed</code> overlay that does <strong>not</strong>
            reflow these children.
          </p>
          <p>
            Try scrolling this column and clicking the nav — both should keep
            working with the panel open. The sidebar toggle should open/close
            without disturbing this layout.
          </p>
          <ul>
            <li>Nav stays pinned on the left.</li>
            <li>Main column keeps its width and scroll.</li>
            <li>Panel docks over the right edge, above content (z-index).</li>
          </ul>
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
            eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim
            ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut
            aliquip ex ea commodo consequat.
          </p>
          <p>
            Duis aute irure dolor in reprehenderit in voluptate velit esse
            cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat
            cupidatat non proident, sunt in culpa qui officia deserunt mollit
            anim id est laborum.
          </p>
        </section>
      </main>
    </div>
  );
}
