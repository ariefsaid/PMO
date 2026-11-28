// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const group = (label, directory) => ({ label, items: [{ autogenerate: { directory } }] });

export default defineConfig({
	site: 'https://docs.pmo-portal.com',
	integrations: [
		starlight({
			title: 'PMO user guide',
			favicon: '/favicon.svg',
			sidebar: [
				{ label: 'Start here', link: '/' },
				{
					label: 'Field and site work',
					items: [
						group('Site reports', 'site-reports'),
						group('Site issues', 'site-issues'),
						group('Crews and attendance', 'crews'),
						group('Material requests', 'material-requests'),
						group('Stock', 'stock'),
						group('Equipment', 'equipment'),
						group('Tasks', 'tasks'),
					],
				},
				group('Office and finance', 'office'),
			],
		}),
	],
});
