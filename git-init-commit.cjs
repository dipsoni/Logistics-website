const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');

const dir = __dirname;

async function initAndCommit() {
  console.log('1. Initializing Git repository...');
  await git.init({ fs, dir });

  const filesToStage = [
    'index.html',
    'styles.css',
    'admin.html',
    'logo.png',
    'hero-truck.jpg',
    'server.cjs',
    'package.json',
    'netlify.toml',
    '.gitignore',
    'netlify/functions/inquiry.cjs'
  ];

  console.log('2. Staging files into Git index...');
  for (const file of filesToStage) {
    const fullPath = path.join(dir, file);
    if (fs.existsSync(fullPath)) {
      await git.add({ fs, dir, filepath: file });
      console.log(`   [Staged] ${file}`);
    }
  }

  console.log('3. Creating initial Git commit...');
  const sha = await git.commit({
    fs,
    dir,
    author: {
      name: 'Shri Shyam Logistics',
      email: 'omshrishyamlogistic@gmail.com',
    },
    message: 'Initial commit: Shri Shyam Logistics & Transport Services website'
  });

  console.log(`\n✅ Git repository initialized successfully! Initial commit SHA: ${sha.slice(0, 7)}`);
}

initAndCommit().catch(err => {
  console.error('Git initialization error:', err);
  process.exit(1);
});
