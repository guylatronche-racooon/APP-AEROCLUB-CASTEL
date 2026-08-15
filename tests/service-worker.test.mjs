import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/sw.js',import.meta.url),'utf8');

function harness(){
  const listeners={},entries=new Map([['/',{ok:true,status:200,source:'cached-root'}],['https://example.test/data/airfields.json',{ok:true,status:200,source:'cached-airfields'}]]);
  let fetchImplementation=async()=>{throw new Error('fetch non configuré');};
  const cache={
    addAll:async (paths)=>{cache.added=Array.from(paths);},
    put:async (key,value)=>{entries.set(typeof key==='string'?key:key.url,value);},
  };
  const caches={
    open:async()=>cache,
    keys:async()=>[],
    delete:async()=>true,
    match:async(key)=>entries.get(typeof key==='string'?key:key.url),
  };
  const self={
    addEventListener:(name,handler)=>{listeners[name]=handler;},
    skipWaiting:async()=>{},
    clients:{claim:async()=>{}},
  };
  const context=vm.createContext({self,caches,URL,Error,Promise,fetch:(...args)=>fetchImplementation(...args)});
  new vm.Script(source,{filename:'sw.js'}).runInContext(context);
  return {listeners,cache,entries,setFetch:(fn)=>{fetchImplementation=fn;}};
}

function fetchEvent(url,{mode='cors'}={}){
  let responsePromise;
  return {
    event:{request:{method:'GET',mode,url},respondWith(value){responsePromise=Promise.resolve(value);}},
    response:()=>responsePromise,
  };
}

test('service worker : installation sans route /index.html inexistante',async()=>{
  const {listeners,cache}=harness();
  let pending;
  listeners.install({waitUntil(value){pending=Promise.resolve(value);}});
  await pending;
  assert.deepEqual(cache.added,[
    '/',
    '/manifest.webmanifest',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png',
    '/data/airfields.json',
    '/documents/manuel-utilisation-outils-de-vol.pdf',
  ]);
});

test('service worker : un HTTP 500 ne remplace pas les données terrain saines en cache',async()=>{
  const {listeners,setFetch}=harness();
  setFetch(async()=>({ok:false,status:500,clone(){return this;}}));
  const call=fetchEvent('https://example.test/data/airfields.json');
  listeners.fetch(call.event);
  const response=await call.response();
  assert.equal(response.source,'cached-airfields');
});

test('service worker : une navigation en erreur retombe sur la racine saine en cache',async()=>{
  const {listeners,setFetch}=harness();
  setFetch(async()=>({ok:false,status:503,clone(){return this;}}));
  const call=fetchEvent('https://example.test/performance',{mode:'navigate'});
  listeners.fetch(call.event);
  const response=await call.response();
  assert.equal(response.source,'cached-root');
});

test('service worker : un scan consulté est conservé pour le mode hors ligne',async()=>{
  const {listeners,setFetch,entries}=harness();
  const url='https://example.test/documents/f-hdlt-pesee-2025.jpeg';
  const online={ok:true,status:200,source:'network-document',clone(){return this;}};
  setFetch(async()=>online);
  const first=fetchEvent(url);
  listeners.fetch(first.event);
  assert.equal((await first.response()).source,'network-document');
  assert.equal(entries.get(url).source,'network-document');

  setFetch(async()=>{throw new Error('hors ligne');});
  const second=fetchEvent(url);
  listeners.fetch(second.event);
  assert.equal((await second.response()).source,'network-document');
});
