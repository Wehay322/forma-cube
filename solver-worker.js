importScripts('./cube.js','./solve.js');
Cube.initSolver();
postMessage({type:'ready'});
onmessage=({data})=>{try{const solution=Cube.fromString(data.state).solve();postMessage({type:'solution',id:data.id,moves:solution.trim()?solution.trim().split(/\s+/):[]});}catch(e){postMessage({type:'error',id:data.id});}};
