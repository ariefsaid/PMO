import React, { useState } from 'react';
import OrgProjectNumberPattern from './OrgProjectNumberPattern';
import OrgProjectClassificationOptions from './OrgProjectClassificationOptions';

type ProjectEditor = 'numbering' | 'classifications' | null;

const ProjectSetupTask: React.FC = () => {
  const [editor, setEditor] = useState<ProjectEditor>(null);
  return (
    <div className="min-w-0 space-y-5" data-testid="project-setup-task">
      <OrgProjectNumberPattern
        editing={editor === 'numbering'}
        onEdit={() => setEditor('numbering')}
        onClose={() => setEditor(null)}
      />
      <OrgProjectClassificationOptions
        editing={editor === 'classifications'}
        onEdit={() => setEditor('classifications')}
        onClose={() => setEditor(null)}
      />
    </div>
  );
};

export default ProjectSetupTask;
