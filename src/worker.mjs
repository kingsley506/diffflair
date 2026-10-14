import {compare,toPatch} from './engine.mjs';
self.onmessage = ({data}) => {
  const start = performance.now();
  try {
    const parsed = {};
    for (const side of ['before','after']) {
      try { parsed[side] = JSON.parse(data[side]); }
      catch (e) { self.postMessage({id:data.id,error:e.message,side}); return; }
    }
    const changes = compare(parsed.before,parsed.after,{ignorePaths:data.ignorePaths});
    let patchError = null;
    try {toPatch(changes);} catch(e) {patchError=e.message;}
    self.postMessage({id:data.id,changes,patchError,elapsed:performance.now()-start});
  } catch (e) { self.postMessage({id:data.id,error:e.message}); }
};
