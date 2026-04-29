const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  console.log(JSON.stringify({ type: 'step_start' }));
  await sleep(500);
  
  console.log(JSON.stringify({ type: 'text', content: 'I am analyzing the task requirements.' }));
  await sleep(1000);
  
  console.log(JSON.stringify({ 
    type: 'tool_use', 
    part: { tool: 'Read', input: { path: 'package.json' } } 
  }));
  console.log('\x1b[36m[System]\x1b[0m Executing tool Read...');
  await sleep(1500);
  
  console.log(JSON.stringify({ type: 'text', content: 'Dependencies look good. Starting build.' }));
  await sleep(800);
  
  for (let i = 1; i <= 3; i++) {
    console.log(`\x1b[33m[Build]\x1b[0m Compiling module ${i}/3...`);
    await sleep(600);
  }
  
  console.log(JSON.stringify({ type: 'step_finish' }));
  console.log('\x1b[32m[Success]\x1b[0m Task completed.');
}

run().catch(console.error);