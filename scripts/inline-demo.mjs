// Folds the Vite build into one artifact-ready HTML fragment.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const assets = readdirSync(join(dist, 'assets'));
const cssFile = assets.find((name) => name.endsWith('.css'));
const jsFile = assets.find((name) => name.endsWith('.js'));

const css = readFileSync(join(dist, 'assets', cssFile), 'utf8');
const js = readFileSync(join(dist, 'assets', jsFile), 'utf8');

const escape = (code) => code.replace(/<\/script>/gi, '<\\/script>');

const html = `<title>Lovely Paradise Operations</title>
<style>
${css}
/* The app commits to one light island palette, so pin the scheme: the
   date and time inputs must not pick up a dark host theme. */
:root { color-scheme: light; }
html, body, #root { min-height: 100%; }
body { margin: 0; }
/* Room for the fixed demo bar. */
main { padding-bottom: 4.5rem; }
</style>
<div id="root"></div>
<script type="module">
${escape(js)}
</script>
`;

writeFileSync(process.argv[2], html);
console.log(`${process.argv[2]}: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
