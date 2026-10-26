import React, { useEffect, useState } from 'react';

export interface RecordSection {
  id: string;
  label: string;
}

/** One local section index: a desktop index becomes a sticky Sections chooser on phones. */
export const RecordSectionIndex: React.FC<{
  identity: string;
  sections: RecordSection[];
  children: React.ReactNode;
}> = ({ identity, sections, children }) => {
  const [currentId, setCurrentId] = useState(sections[0]?.id ?? '');
  const currentSection = sections.find((section) => section.id === currentId) ?? sections[0];

  useEffect(() => {
    if (!('IntersectionObserver' in window) || sections.length === 0) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible?.target.id) setCurrentId(visible.target.id);
    }, { rootMargin: '-20% 0px -65% 0px' });
    for (const section of sections) {
      const target = document.getElementById(section.id);
      if (target) observer.observe(target);
    }
    return () => observer.disconnect();
  }, [sections]);

  const links = (
    <ul className="flex flex-col gap-1">
      {sections.map((section) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            onClick={() => setCurrentId(section.id)}
            aria-current={currentId === section.id ? 'location' : undefined}
            className="touch-target flex min-h-11 items-center break-words rounded-md px-2 text-xs font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {section.label}
          </a>
        </li>
      ))}
    </ul>
  );

  if (sections.length < 2) return <div className="min-w-0">{children}</div>;

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <aside className="min-w-0">
        <nav aria-label={`${identity} sections`} className="sticky top-4 hidden h-fit lg:block">
          <h2 className="mb-2 text-xl font-bold">Sections</h2>
          {links}
        </nav>
        <details className="sticky top-0 z-10 mb-4 rounded-md border border-border bg-background px-3 lg:hidden">
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 text-xs font-semibold text-foreground">
            <span className="break-words">{identity}</span>
            <span aria-hidden="true">·</span>
            <span className="break-words">{currentSection?.label ?? 'Sections'}</span>
          </summary>
          {links}
        </details>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
};
