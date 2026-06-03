
import React from 'react';
import Card from '../components/Card';

interface PlaceholderPageProps {
  title: string;
}

const PlaceholderPage: React.FC<PlaceholderPageProps> = ({ title }) => {
  return (
    <Card className="h-full flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{title}</h2>
        <p className="mt-2 text-gray-500 dark:text-gray-400">This section is under construction.</p>
         <div className="mt-8 text-6xl text-gray-300 dark:text-gray-600">
            🏗️
        </div>
      </div>
    </Card>
  );
};

export default PlaceholderPage;
