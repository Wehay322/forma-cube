import * as THREE from './three.module.js';
import {RoundedBoxGeometry} from './RoundedBoxGeometry.js';

const $=id=>document.getElementById(id);
const FACE={R:{axis:'x',layer:1,sign:-1,name:'Правая грань',short:'Правая',color:'#d94d43'},L:{axis:'x',layer:-1,sign:1,name:'Левая грань',short:'Левая',color:'#e39237'},U:{axis:'y',layer:1,sign:-1,name:'Верхняя грань',short:'Верхняя',color:'#f0ede3'},D:{axis:'y',layer:-1,sign:1,name:'Нижняя грань',short:'Нижняя',color:'#e2c33e'},F:{axis:'z',layer:1,sign:-1,name:'Передняя грань',short:'Передняя',color:'#45a27b'},B:{axis:'z',layer:-1,sign:1,name:'Задняя грань',short:'Задняя',color:'#447fc2'}};
const MOVE={...FACE,M:{axis:'x',layer:0,sign:1},E:{axis:'y',layer:0,sign:1},S:{axis:'z',layer:0,sign:-1}};
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let model=new window.Cube(), cubies=[], busy=false, hintOn=false, solverReady=false, solution=[], revision=0, pending=false;
let count=0, history=[], initial=[], elapsed=0, startedAt=0, running=false, targetYaw=.63,targetPitch=.48,yaw=.63,pitch=.48,moveDuration=500;
let toastTimeout;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('toast').classList.remove('show'),3600);}
function inverse(move){return move.endsWith('2')?move:move.endsWith("'")?move[0]:move+"'";}
function moveWord(n){return n%10===1&&n%100!==11?'ход':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'хода':'ходов';}
function scrambleSequence(){let last='';return Array.from({length:20},()=>{let f;do{f='RLUDFB'[Math.floor(Math.random()*6)];}while(f===last);last=f;return f+['',"'",'2'][Math.floor(Math.random()*3)];});}

const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(34,1,.1,100);
const renderer=(()=>{try{return new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}catch(e){$('webglError').hidden=false;return null;}})();
if(!renderer) throw new Error('WebGL unavailable');
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
$('scene').appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff,1.6));
const keyLight=new THREE.DirectionalLight(0xfff4e3,3);keyLight.position.set(-3,7,6);scene.add(keyLight);
const fillLight=new THREE.DirectionalLight(0xc9e1ff,1.7);fillLight.position.set(5,2,-4);scene.add(fillLight);
const root=new THREE.Group();scene.add(root);root.position.y=.12;
const bodyGeo=new RoundedBoxGeometry(.96,.96,.96,3,.075);
const bodyMat=new THREE.MeshStandardMaterial({color:'#10171b',roughness:.42,metalness:.08});
const stickerShape=new THREE.Shape();const w=.417,r=.065;
stickerShape.moveTo(-w+r,-w);stickerShape.lineTo(w-r,-w);stickerShape.quadraticCurveTo(w,-w,w,-w+r);stickerShape.lineTo(w,w-r);stickerShape.quadraticCurveTo(w,w,w-r,w);stickerShape.lineTo(-w+r,w);stickerShape.quadraticCurveTo(-w,w,-w,w-r);stickerShape.lineTo(-w,-w+r);stickerShape.quadraticCurveTo(-w,-w,-w+r,-w);
const stickerGeo=new THREE.ExtrudeGeometry(stickerShape,{depth:.008,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.012,bevelThickness:.008,curveSegments:6});
const faceMaterials=Object.fromEntries(Object.entries(FACE).map(([f,v])=>[f,new THREE.MeshStandardMaterial({color:v.color,roughness:.32,metalness:.03})]));
function createCube(){
  for(const c of cubies){for(const s of c.children)if(s.userData.sticker)s.material.dispose();root.remove(c);}cubies=[];
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
    if(!x&&!y&&!z)continue;
    const c=new THREE.Group();c.position.set(x,y,z);c.add(new THREE.Mesh(bodyGeo,bodyMat));
    for(const [f,v] of Object.entries(FACE))if(c.position[v.axis]===v.layer){
      const sticker=new THREE.Mesh(stickerGeo,faceMaterials[f].clone());const n=new THREE.Vector3();n[v.axis]=v.layer;
      sticker.position.copy(n).multiplyScalar(.486);sticker.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),n);sticker.userData={sticker:true,face:f,normal:n};c.add(sticker);
    }
    cubies.push(c);root.add(c);
  }
}
const turnGroup=new THREE.Group();root.add(turnGroup);
function angleFor(move){const v=MOVE[move[0]];return v.sign*Math.PI/2*(move.endsWith('2')?2:move.endsWith("'")?-1:1);}
function finishLayer(selected,axis,angle){
  turnGroup.rotation[axis]=angle;turnGroup.updateMatrixWorld(true);
  for(const c of selected){root.attach(c);c.position.set(Math.round(c.position.x),Math.round(c.position.y),Math.round(c.position.z));c.quaternion.normalize();}
  turnGroup.rotation.set(0,0,0);
}
function visualTurn(move,duration=0,fromAngle=0){
  const v=MOVE[move[0]],selected=cubies.filter(c=>Math.round(c.position[v.axis])===v.layer),angle=angleFor(move);
  for(const c of selected)if(c.parent!==turnGroup)turnGroup.attach(c);
  if(!duration){finishLayer(selected,v.axis,angle);return Promise.resolve();}
  return new Promise(resolve=>{let begin=performance.now();function frame(now){const t=Math.min(1,(now-begin)/duration);const ease=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;turnGroup.rotation[v.axis]=fromAngle+(angle-fromAngle)*ease;if(t<1)requestAnimationFrame(frame);else{finishLayer(selected,v.axis,angle);resolve();}}requestAnimationFrame(frame);});
}
// A ring on the actual face shows clockwise direction when viewed from outside.
const arrowGroup=new THREE.Group();root.add(arrowGroup);arrowGroup.visible=false;
const arrowMat=new THREE.MeshBasicMaterial({color:'#f9ffe7',depthTest:false,transparent:true,opacity:.98});
const arrowOutline=new THREE.MeshBasicMaterial({color:'#202b25',depthTest:false,transparent:true,opacity:.95});
function clearArrow(){while(arrowGroup.children.length){const obj=arrowGroup.children[0];obj.geometry?.dispose();arrowGroup.remove(obj);}}
function showArrow(move){
  clearArrow();document.querySelectorAll('.face-control').forEach(el=>el.classList.toggle('active',hintOn&&el.dataset.face===move?.[0]));
  if(!hintOn||!move||busy){arrowGroup.visible=false;return;}
  const v=FACE[move[0]],n=new THREE.Vector3();n[v.axis]=v.layer;arrowGroup.position.copy(n).multiplyScalar(1.535);arrowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),n);
  const dir=move.endsWith("'")?1:-1,start=1.05,end=start+dir*Math.PI*1.45;
  const points=Array.from({length:55},(_,i)=>{const a=start+(end-start)*i/54;return new THREE.Vector3(Math.cos(a)*.89,Math.sin(a)*.89,.025);});
  const curve=new THREE.CatmullRomCurve3(points);
  const outline=new THREE.Mesh(new THREE.TubeGeometry(curve,60,.048,8,false),arrowOutline);outline.renderOrder=10;arrowGroup.add(outline);
  const ring=new THREE.Mesh(new THREE.TubeGeometry(curve,60,.022,8,false),arrowMat);ring.renderOrder=11;arrowGroup.add(ring);
  const tangent=new THREE.Vector3(-Math.sin(end)*dir,Math.cos(end)*dir,0);
  for(const [radius,height,mat,order]of[[.16,.31,arrowOutline,10],[.115,.255,arrowMat,12]]){const cone=new THREE.Mesh(new THREE.ConeGeometry(radius,height,3),mat);cone.position.copy(points.at(-1)).addScaledVector(tangent,.06);cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),tangent);cone.renderOrder=order;arrowGroup.add(cone);}
  arrowGroup.visible=true;
}
function faceView(f){const views={R:[1.12,.3],L:[-1.12,.3],F:[.25,.35],B:[Math.PI+.25,.35],U:[.45,1.12],D:[.45,-1.12]};let[a,b]=views[f];while(a-targetYaw>Math.PI)a-=2*Math.PI;while(a-targetYaw< -Math.PI)a+=2*Math.PI;targetYaw=a;targetPitch=b;}
function resize(){const rect=$('scene').getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe($('scene'));resize();
let lastFrame=performance.now();
function render(now){requestAnimationFrame(render);const dt=Math.min(50,now-lastFrame);lastFrame=now;const lerp=reduced?1:1-Math.exp(-dt*.009);yaw+=(targetYaw-yaw)*lerp;pitch+=(targetPitch-pitch)*lerp;const distance=camera.aspect<1?13.4:11.8;camera.position.set(distance*Math.sin(yaw)*Math.cos(pitch),distance*Math.sin(pitch)+.12,distance*Math.cos(yaw)*Math.cos(pitch));camera.lookAt(0,.12,0);if(arrowGroup.visible&&!reduced)arrowMat.opacity=.84+Math.sin(now*.003)*.14;renderer.render(scene,camera);}
requestAnimationFrame(render);

let drag=null,hovered=null;const raycaster=new THREE.Raycaster();
function pickSticker(e){const rect=$('scene').getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);return raycaster.intersectObjects(cubies,true).find(h=>h.object.userData.sticker);}
function highlight(sticker){if(hovered===sticker)return;if(hovered){hovered.material.emissive.setHex(0);hovered.material.emissiveIntensity=0;}hovered=sticker;if(hovered){hovered.material.emissive.set('#ffffff');hovered.material.emissiveIntensity=.12;}}
function screenPoint(p){const rect=$('scene').getBoundingClientRect(),v=root.localToWorld(p.clone()).project(camera);return new THREE.Vector2((v.x+1)*rect.width/2,(1-v.y)*rect.height/2);}
$('scene').addEventListener('contextmenu',e=>e.preventDefault());
$('scene').addEventListener('pointerdown',e=>{
  if(busy||drag)return;
  const hit=e.button===2||e.altKey?null:pickSticker(e);
  drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,hit,angle:0,mode:hit?'pending':'orbit'};
  if(hit){drag.point=root.worldToLocal(hit.point.clone());drag.normal=hit.object.userData.normal.clone().applyQuaternion(hit.object.parent.quaternion);}
  $('scene').setPointerCapture(e.pointerId);$('scene').classList.add('dragging');highlight(null);
});
$('scene').addEventListener('pointermove',e=>{
  if(!drag){if(!busy){const hit=pickSticker(e);highlight(hit?.object||null);$('scene').classList.toggle('over-sticker',!!hit);}return;}
  const delta=new THREE.Vector2(e.clientX-drag.x,e.clientY-drag.y);
  if(drag.mode==='pending'&&delta.length()>9){
    const normalAxis=['x','y','z'].sort((a,b)=>Math.abs(drag.normal[b])-Math.abs(drag.normal[a]))[0];
    const candidates=['x','y','z'].filter(a=>a!==normalAxis).map(axis=>{const av=new THREE.Vector3();av[axis]=1;const tangent=new THREE.Vector3().crossVectors(av,drag.point);const projected=screenPoint(drag.point.clone().addScaledVector(tangent,.1)).sub(screenPoint(drag.point)).multiplyScalar(10);return{axis,projected,score:Math.abs(projected.clone().normalize().dot(delta.clone().normalize()))};});
    candidates.sort((a,b)=>b.score-a.score);const chosen=candidates[0];
    const layer=Math.round(drag.hit.object.parent.position[chosen.axis]);
    const notation=Object.keys(MOVE).find(f=>MOVE[f].axis===chosen.axis&&MOVE[f].layer===layer);
    drag.axis=chosen.axis;drag.projected=chosen.projected;drag.notation=notation;drag.selected=cubies.filter(c=>Math.round(c.position[drag.axis])===layer);drag.mode='twist';
    for(const c of drag.selected)turnGroup.attach(c);
    busy=true;arrowGroup.visible=false;updateStats();$('scene').classList.add('twisting');
  }
  if(drag.mode==='twist'){
    drag.angle=THREE.MathUtils.clamp(delta.dot(drag.projected)/drag.projected.lengthSq(),-Math.PI/2,Math.PI/2);
    turnGroup.rotation[drag.axis]=drag.angle;
  }else if(drag.mode==='orbit'){
    targetYaw-=(e.clientX-drag.lastX)*.008;targetPitch=Math.max(-1.3,Math.min(1.3,targetPitch+(e.clientY-drag.lastY)*.008));
  }
  drag.lastX=e.clientX;drag.lastY=e.clientY;
});
function cancelTwist(d){
  const start=performance.now(),duration=reduced?0:220;
  function frame(now){const t=duration?Math.min(1,(now-start)/duration):1;turnGroup.rotation[d.axis]=d.angle*Math.pow(1-t,3);if(t<1)requestAnimationFrame(frame);else{finishLayer(d.selected,d.axis,0);busy=false;updateStats();showArrow(solution[0]);}}
  requestAnimationFrame(frame);
}
function endDrag(e,cancelled=false){
  if(!drag)return;const d=drag;drag=null;$('scene').classList.remove('dragging','twisting');
  if(d.mode==='twist'){
    if(cancelled||Math.abs(d.angle)<.12){cancelTwist(d);return;}
    const move=d.notation+(Math.sign(d.angle)===MOVE[d.notation].sign?'':"'");
    busy=false;performMove(move,{previewAngle:d.angle});
  }else if(d.mode==='pending'&&!cancelled){toast('Потяни квадратик в сторону — слой последует за мышью');}
}
$('scene').addEventListener('pointerup',e=>endDrag(e));
$('scene').addEventListener('pointercancel',e=>endDrag(e,true));
$('scene').addEventListener('pointerleave',()=>{if(!drag)highlight(null);});
$('viewReset').onclick=()=>{targetYaw=.63;targetPitch=.48;};

function timeValue(){return elapsed+(running?performance.now()-startedAt:0);}
function updateTime(){const t=Math.floor(timeValue()/1000);$('timer').textContent=String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');}
setInterval(updateTime,250);
function save(){try{localStorage.setItem('forma-session',JSON.stringify({initial,history,count,elapsed:timeValue()}));}catch{}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});
function updateStats(){const solved=model.isSolved();const state=model.asString();for(const [i,f]of [...'URFDLB'].entries()){document.querySelector('.face-control[data-face="'+f+'"]')?.style.setProperty('--face-color',FACE[state[i*9+4]].color);}$('moves').innerHTML=String(count).padStart(2,'0')+'<span>'+moveWord(count)+'</span>';$('undo').disabled=busy||!history.length;$('scramble').disabled=busy;$('reset').disabled=busy;$('applyHint').disabled=busy||pending||!hintOn||!solution.length;$('cubeStatus').innerHTML='<i></i> '+(busy?'Поворот за поворотом…':solved?'Всё сложилось':count?'В процессе сборки':'Кубик перемешан');}
async function performMove(move,{undo=false,previewAngle=0}={}){
  if(busy)return;busy=true;arrowGroup.visible=false;updateStats();
  if(!running&&!model.isSolved()){running=true;startedAt=performance.now();}
  highlight(null);await visualTurn(move,reduced?0:previewAngle?Math.max(180,moveDuration*.65):moveDuration,previewAngle);model.move(move);revision++;
  if(undo){history.pop();count=Math.max(0,count-1);}else{history.push(move);count++;}
  busy=false;
  if(!running&&!model.isSolved()){running=true;startedAt=performance.now();}
  if(model.isSolved()){if(running){elapsed=timeValue();running=false;}solution=[];pending=false;toast('Всё сложилось! '+count+' '+moveWord(count)+' · '+$('timer').textContent);if(!reduced){document.querySelector('.play-area').animate([{boxShadow:'inset 0 0 0 1px #c5d0a500'},{boxShadow:'inset 0 0 0 2px #c5d0a5aa,0 0 45px #c5d0a51a'},{boxShadow:'inset 0 0 0 1px #c5d0a500'}],{duration:1400});}updateHint();}
  else if(hintOn){if(solution[0]===move&&!undo){solution.shift();updateHint();if(solution.length)faceView(solution[0][0]);else requestSolution();}else requestSolution();}
  updateStats();save();
}
function loadInitial(sequence){createCube();model=new window.Cube();for(const move of sequence){visualTurn(move);model.move(move);}solution=[];pending=false;revision++;}
async function startNew(sequence,animated=true){
  if(busy)return;busy=true;highlight(null);$('scramble').classList.add('is-shuffling');history=[];count=0;elapsed=0;running=false;initial=sequence;solution=[];pending=false;revision++;arrowGroup.visible=false;updateStats();updateHint();
  createCube();model=new window.Cube();
  for(const move of sequence){await visualTurn(move,animated&&!reduced?60:0);model.move(move);}
  busy=false;$('scramble').classList.remove('is-shuffling');updateTime();updateStats();if(hintOn)requestSolution();save();
}
$('scramble').onclick=()=>startNew(scrambleSequence());
$('reset').onclick=()=>{startNew([...initial]);toast('Новая попытка с тем же положением кубика');};
$('undo').onclick=()=>{if(history.length)performMove(inverse(history.at(-1)),{undo:true});};
$('speed').onchange=e=>{moveDuration=Number(e.target.value);};

const worker=new Worker('./solver-worker.js');
worker.onmessage=({data})=>{
  if(data.type==='ready'){solverReady=true;if(hintOn)requestSolution();return;}
  if(data.id!==revision||!hintOn)return;
  pending=false;
  if(data.type==='error'){solution=[];toast('Не удалось рассчитать подсказку. Попробуй ещё раз.');}else solution=data.moves;
  updateHint();updateStats();if(solution.length&&!busy)faceView(solution[0][0]);
};
worker.onerror=()=>{pending=false;solverReady=false;updateHint('Подсказки временно недоступны');toast('Перезагрузи страницу, чтобы запустить подсказки.');};
function requestSolution(){
  solution=[];pending=true;showArrow(null);updateHint();updateStats();if(solverReady)worker.postMessage({state:model.asString(),id:revision});
}
function updateHint(error){
  const move=hintOn?solution[0]:null;
  $('hintToggle').setAttribute('aria-checked',String(hintOn));
  $('hintLabel').textContent=hintOn?'ТВОЙ СЛЕДУЮЩИЙ ХОД':'В СВОЁМ РИТМЕ';
  $('hintFraction').textContent=move?solution.length+' до цели':'—';
  $('hintArrow').textContent=move?.endsWith("'")?'↶':'↻';
  $('hintNotation').textContent=move||'·';
  $('hintFace').textContent=error||(!hintOn?'Доверься интуиции':pending?'Ищем путь к решению':move?FACE[move[0]].name:model.isSolved()?'Всё сложилось!':'Готово к следующему ходу');
  $('hintDescription').textContent=!hintOn?'Или включи подсказки выше':pending?(solverReady?'Рассчитываем следующий шаг…':'Подготавливаем подсказки…'):move?(move.endsWith('2')?'Поверни на 180°':move.endsWith("'")?'Против часовой · 90°':'По часовой стрелке · 90°'):'Можно перемешать и попробовать снова';
  $('hintDetail').textContent=move?'Смотри на выделенную грань. Стрелка показывает поворот с её внешней стороны.':pending?'Это займёт несколько секунд. Кубик уже ищет свой порядок.':'Стрелка на кубике покажет нужную грань и направление поворота.';
  $('applyHint').disabled=busy||pending||!move;
  showArrow(move);if(move&&!reduced)$('hintNotation').animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:300,easing:'ease-out'});
}
$('hintToggle').onclick=()=>{hintOn=!hintOn;if(hintOn&&!model.isSolved()&&!busy)requestSolution();else updateHint();};
$('applyHint').onclick=()=>{if(solution.length)performMove(solution[0]);};

for(const [f,v]of Object.entries(FACE)){
  const el=document.createElement('div');el.className='face-control';el.dataset.face=f;el.style.setProperty('--face-color',v.color);
  el.innerHTML='<div class="face-title"><span class="color-dot"></span>'+f+'</div><div class="face-name">'+v.short+'</div><div class="face-arrows"><button aria-label="'+v.name+': по часовой стрелке" title="'+f+'">↻</button><button aria-label="'+v.name+': против часовой стрелки" title="'+f+"' (Shift + "+f+')">↶</button></div>';
  el.querySelectorAll('button').forEach((b,i)=>b.onclick=()=>performMove(f+(i?"'":'')));$('faceControls').appendChild(el);
}
document.addEventListener('keydown',e=>{if($('guide').open||e.ctrlKey||e.metaKey||e.altKey||['SELECT','INPUT','TEXTAREA','BUTTON'].includes(document.activeElement.tagName))return;const f=e.key.toUpperCase();if(FACE[f]){e.preventDefault();performMove(f+(e.shiftKey?"'":''));}});
$('openGuide').onclick=()=>$('guide').showModal();$('closeGuide').onclick=()=>$('guide').close();$('startPlaying').onclick=()=>$('guide').close();
$('guide').addEventListener('click',e=>{if(e.target===$('guide')){const r=$('guide').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('guide').close();}});
try{const stored=JSON.parse(localStorage.getItem('forma-session'));const valid=a=>Array.isArray(a)&&a.length<5000&&a.every(m=>/^[RLUDFBMES](2|')?$/.test(m));if(stored&&valid(stored.initial)&&valid(stored.history)){initial=stored.initial;loadInitial([...initial,...stored.history]);history=stored.history;count=history.length;elapsed=Number.isFinite(stored.elapsed)?Math.max(0,stored.elapsed):0;}else throw 0;}catch{initial=scrambleSequence();loadInitial(initial);}
updateStats();updateTime();updateHint();save();

// Read-only state inspection helps verify that rendered stickers match the solver.
window.forma={get state(){return model.asString();},get solved(){return model.isSolved();},get solution(){return [...solution];},visualState(){const faces={U:Array(9),R:Array(9),F:Array(9),D:Array(9),L:Array(9),B:Array(9)};for(const c of cubies){for(const s of c.children.filter(s=>s.userData.sticker)){const n=s.userData.normal.clone().applyQuaternion(c.quaternion);const x=Math.round(c.position.x),y=Math.round(c.position.y),z=Math.round(c.position.z);let f,i;if(n.y>.9){f='U';i=(z+1)*3+x+1;}else if(n.y<-.9){f='D';i=(1-z)*3+x+1;}else if(n.x>.9){f='R';i=(1-y)*3+1-z;}else if(n.x<-.9){f='L';i=(1-y)*3+z+1;}else if(n.z>.9){f='F';i=(1-y)*3+x+1;}else{f='B';i=(1-y)*3+1-x;}faces[f][i]=s.userData.face;}}return ['U','R','F','D','L','B'].map(f=>faces[f].join('')).join('');}};
