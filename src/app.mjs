import {summarize,maskChanges,toPatch,toHTML,toMarkdown} from './engine.mjs';
import {samples} from './samples.mjs';
const $ = id => document.getElementById(id);
const MAX = 2 * 1024 * 1024;
const text = {
  en:{local:'LOCAL BY DESIGN',eyebrow:'LESS NOISE. MORE SIGNAL.',title:'JSON changes.',subtitle:'Made clear.',intro:'Compare locally. Share a report. Keep your data yours.',workspace:'Workspace',noUpload:'No uploads · No account',exampleWebhook:'Example: API response',exampleConfig:'Example: app config',exampleArray:'Example: arrays',swap:'⇄ Swap',clear:'Clear',before:'Before',after:'After',format:'Format',open:'Open file ↗',ignore:'Ignore paths',compare:'Compare JSON',resultEyebrow:'THE DIFFERENCE',mask:'Mask sensitive fields',all:'All',added:'Added',removed:'Removed',changed:'Changed',more:'Show more changes',shareTitle:'A difference worth sharing.',shareCopy:'One HTML file. Opens anywhere. No internet needed.',markdown:'Markdown ↓',patch:'JSON Patch ↓',html:'Export report ↗',rules:'Arrays compare by position. Masks cover common key names, so review reports before sharing. JSON Patch contains original values.',footer:'Small tool. Clear changes.',privacy:'Your JSON stays in this tab.',ready:'Ready to compare',stale:'Inputs changed — compare again',comparing:'Comparing…',noChanges:'No changes. All clear.',matches:'No matching changes',empty:'Paste two JSON documents to get started.',equal:'These documents match under your comparison rules.',search:'Find a path…',invalid:'Invalid JSON',large:'Each input must be under 2 MiB.',download:'Report downloaded',copied:'Path copied',copyFailed:'Could not copy this path',ignoreError:'Use JSON pointers separated by commas, e.g. /updated_at',patchDownload:'Original values exported in JSON Patch',count:n=>`${n} ${n===1?'change':'changes'} found`,placeholder:'Paste JSON or drop a .json file here',invalidExport:'Compare the current inputs before exporting.'},
  zh:{local:'所有比较在本地完成',eyebrow:'看见变化，略过噪声。',title:'JSON 有变化？',subtitle:'一眼看清。',intro:'本地比较，一键导出，让数据留在你手中。',workspace:'工作台',noUpload:'无需上传 · 无需账号',exampleWebhook:'示例：API 响应',exampleConfig:'示例：应用配置',exampleArray:'示例：数组',swap:'⇄ 交换',clear:'清空',before:'变化前',after:'变化后',format:'格式化',open:'打开文件 ↗',ignore:'忽略路径',compare:'开始比较',resultEyebrow:'变化，尽在眼前',mask:'遮罩常见敏感字段',all:'全部',added:'新增',removed:'删除',changed:'修改',more:'显示更多变化',shareTitle:'把变化，讲清楚。',shareCopy:'一个 HTML 文件，离线也能打开。',markdown:'Markdown ↓',patch:'JSON Patch ↓',html:'导出报告 ↗',rules:'数组按位置比较。遮罩按常见字段名识别，分享前请检查。JSON Patch 包含未经遮罩的原始值。',footer:'小工具，清晰的变化。',privacy:'你的 JSON 留在当前标签页。',ready:'准备开始比较',stale:'输入已更改，请重新比较',comparing:'正在比较…',noChanges:'没有变化，一切如常。',matches:'没有匹配的变化',empty:'粘贴两份 JSON 文档，开始比较。',equal:'按当前比较规则，两份文档一致。',search:'搜索变化路径…',invalid:'JSON 格式无效',large:'每份输入不能超过 2 MiB。',download:'报告已下载',copied:'路径已复制',copyFailed:'无法复制路径',ignoreError:'请填写逗号分隔的 JSON Pointer 路径，如 /updated_at',patchDownload:'已导出含原始值的 JSON Patch',count:n=>`发现 ${n} 处变化`,placeholder:'粘贴 JSON 或将 .json 文件拖到这里',invalidExport:'请先比较当前输入再导出。'}
};
let lang = 'en', filter = 'all', result = null, valid = false, id = 0, pageLimit = 150, toastTimer, currentIgnore = [], patchError = null;
let worker = new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
const t = key => text[lang][key];
function message(value) { $('toast').textContent=value;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
function exportsEnabled(enable) {for (const name of ['html','markdown','patch']) $(name).disabled=!enable;}
function lines(side) {
  const input=$(side), bytes=new TextEncoder().encode(input.value).length;
  $(side+'-size').textContent=bytes<1024?`${bytes} B`:`${(bytes/1024).toFixed(1)} KB`;
  $(side+'-lines').textContent=Array.from({length:Math.min(3000,input.value.split('\n').length)},(_,i)=>i+1).join('\n');
  $(side+'-lines').scrollTop=input.scrollTop;
}
function stale() {id++;valid=false;exportsEnabled(false);$('results-title').textContent=t('stale');$('changes').classList.add('stale');for (const side of ['before','after']) $(side+'-error').textContent='';$('compare').disabled=false;}
function displayValue(value,present) {return present?JSON.stringify(value,null,2):'—';}
function render() {
  const changes=result?($('mask').checked?maskChanges(result):result):[];
  const counts=summarize(changes);
  for(const name of ['all','added','changed','removed']) $('count-'+name).textContent=name==='all'?counts.total:counts[name];
  $('results-title').textContent=valid?(counts.total?t('count')(counts.total):t('noChanges')):(result?t('stale'):t('ready'));
  $('changes').replaceChildren();
  const query=$('search').value.toLowerCase();
  const selected=changes.filter(c=>(filter==='all'||c.kind===filter)&&c.path.toLowerCase().includes(query));
  if (!selected.length) {
    const box=document.createElement('div');box.className='empty';
    const heading=document.createElement('strong');heading.textContent=!result?t('ready'):changes.length?t('matches'):t('noChanges');
    const desc=document.createElement('span');desc.textContent=!result?t('empty'):changes.length?'':t('equal');
    box.append(heading,desc);$('changes').append(box);
  }
  for(const c of selected.slice(0,pageLimit)) {
    const row=document.createElement('div');row.className='change-row';
    const kind=document.createElement('span');kind.className='kind '+c.kind;kind.textContent=({added:'+',removed:'−',changed:'~'})[c.kind]+' '+t(c.kind).toUpperCase();
    const path=document.createElement('button');path.className='path';path.textContent=c.path||'(root)';path.title=lang==='en'?'Copy JSON pointer':'复制 JSON Pointer';
    path.onclick=async()=>{try{await navigator.clipboard.writeText(c.path);message(t('copied'));}catch{message(t('copyFailed'));}};
    const values=document.createElement('div');values.className='values';
    for(const [key,cls] of [['before','old'],['after','new']]) {const v=document.createElement('pre');const present=Object.hasOwn(c,key);v.className='value '+(present?cls:'absent');v.textContent=displayValue(c[key],present);values.append(v);}
    row.append(kind,path,values);$('changes').append(row);
  }
  $('more').hidden=selected.length<=pageLimit;
  $('changes').classList.toggle('stale',!valid&&!!result);
}
function translate() {
  document.documentElement.lang=lang==='zh'?'zh-CN':'en';
  for(const el of document.querySelectorAll('[data-i18n]')) el.textContent=t(el.dataset.i18n);
  $('language').textContent=lang==='en'?'中文':'English';$('search').placeholder=t('search');
  for(const side of ['before','after']) {$(side).placeholder=t('placeholder');$(side).setAttribute('aria-label',t(side)+' JSON');}
  render();
}
function loadExample() {const pair=samples[$('example').value];for(const [index,side] of ['before','after'].entries()) {$(side).value=JSON.stringify(pair[index],null,2);lines(side);} $('ignore').value=$('example').value==='webhook'?'/updated_at':'';stale();compare();}
function compare() {
  const before=$('before').value, after=$('after').value;
  if([before,after].some(v=>new TextEncoder().encode(v).length>MAX)) {message(t('large'));return;}
  const input=$('ignore').value.trim();
  currentIgnore=input?input.split(',').map(x=>x.trim()).filter(Boolean):[];
  if(currentIgnore.some(p=>!p.startsWith('/')||/~(?![01])/u.test(p))) {message(t('ignoreError'));return;}
  const request=++id;valid=false;exportsEnabled(false);$('compare').disabled=true;$('results-title').textContent=t('comparing');
  for(const side of ['before','after']) $(side+'-error').textContent='';
  worker.postMessage({id:request,before,after,ignorePaths:currentIgnore});
}
worker.onmessage=({data})=>{
  if(data.id!==id)return;
  $('compare').disabled=false;
  if(data.error) {valid=false;exportsEnabled(false);$('results-title').textContent=t('invalid');$('changes').classList.add('stale');if(data.side)$(data.side+'-error').textContent=data.error;else message(data.error);return;}
  result=data.changes;patchError=data.patchError;valid=true;pageLimit=150;$('elapsed').textContent=`${Math.max(1,Math.round(data.elapsed))} ms`;exportsEnabled(true);render();
};
worker.onerror=()=>{$('compare').disabled=false;valid=false;exportsEnabled(false);message(lang==='en'?'Could not load the comparison engine. Serve the project over HTTP and reload.':'无法加载比较引擎，请通过 HTTP 启动并刷新。');};
function download(content,name,type) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function openFile(file,side) {if(!file)return;if(file.size>MAX){message(t('large'));return;}try{$(side).value=await file.text();lines(side);stale();}catch(e){message(e.message);}}
for(const side of ['before','after']) {
  $(side).addEventListener('input',()=>{lines(side);stale();});
  $(side).addEventListener('scroll',()=>{$(side+'-lines').scrollTop=$(side).scrollTop;});
  $(side).addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();const el=$(side),start=el.selectionStart,end=el.selectionEnd;el.setRangeText('  ',start,end,'end');lines(side);stale();}});
  const panel=document.querySelector(`.editor-panel[data-side="${side}"]`);
  panel.addEventListener('dragover',e=>{e.preventDefault();panel.classList.add('dragging');});
  panel.addEventListener('dragleave',()=>panel.classList.remove('dragging'));
  panel.addEventListener('drop',e=>{e.preventDefault();panel.classList.remove('dragging');openFile(e.dataTransfer.files[0],side);});
}
for(const b of document.querySelectorAll('.format')) b.onclick=()=>{const side=b.dataset.side;try{$(side).value=JSON.stringify(JSON.parse($(side).value),null,2);lines(side);stale();}catch(e){$(side+'-error').textContent=e.message;}};
for(const b of document.querySelectorAll('.upload')) b.onclick=()=>{$('file').dataset.side=b.dataset.side;$('file').value='';$('file').click();};
$('file').onchange=()=>openFile($('file').files[0],$('file').dataset.side);
$('compare').onclick=compare;$('example').onchange=loadExample;
$('language').onclick=()=>{lang=lang==='en'?'zh':'en';translate();};
$('swap').onclick=()=>{const tmp=$('before').value;$('before').value=$('after').value;$('after').value=tmp;for(const side of ['before','after'])lines(side);stale();compare();};
$('clear').onclick=()=>{for(const side of ['before','after']){$(side).value='';lines(side);$(side+'-error').textContent='';}$('ignore').value='';result=null;id++;valid=false;exportsEnabled(false);$('compare').disabled=false;$('elapsed').textContent='';render();$('before').focus();};
$('ignore').oninput=stale;$('mask').onchange=render;
$('search').oninput=()=>{pageLimit=150;render();};
for(const button of document.querySelectorAll('[data-filter]'))button.onclick=()=>{filter=button.dataset.filter;pageLimit=150;for(const b of document.querySelectorAll('[data-filter]')){b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));}render();};
$('more').onclick=()=>{pageLimit+=150;render();};
for(const format of ['html','markdown','patch'])$(format).onclick=()=>{
  if(!valid){message(t('invalidExport'));return;}
  try {
    const options={redact:$('mask').checked,ignorePaths:currentIgnore};
    if(format==='html')download(toHTML(result,options),'diffflair-report.html','text/html;charset=utf-8');
    if(format==='markdown')download(toMarkdown(result,options),'diffflair-report.md','text/markdown;charset=utf-8');
    if(format==='patch'){if(patchError)throw Error(patchError);download(JSON.stringify(toPatch(result),null,2)+'\n','diffflair.patch.json','application/json');}
    message(t(format==='patch'?'patchDownload':'download'));
  }catch(e){message(e.message);}
};
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();compare();}});
translate();loadExample();
