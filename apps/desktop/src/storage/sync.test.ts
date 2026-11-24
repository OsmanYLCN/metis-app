import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({send:vi.fn(),read:vi.fn(),tasks:vi.fn(),invoke:vi.fn()}));
vi.mock('../identity/login',()=>({loginStore:{sendWorkspace:mocks.send,readChanges:mocks.read},WorkspaceConflictError:class extends Error{}}));
vi.mock('../tasks/sync',()=>({syncPendingTasks:mocks.tasks}));
import {syncNow,downloadCloud,deliverWorkspace} from './sync';
import {WorkspaceConflictError} from '../identity/login';
const owner={projectRef:'test-project',userId:'11111111-1111-4111-8111-111111111111'};
const op={entity:'note',id:'a'.repeat(32),operationId:'b'.repeat(32),action:'update',expectedRevision:1,payload:{}};
beforeEach(()=>{
 vi.resetAllMocks();vi.stubGlobal('window',{__TAURI__:{core:{invoke:mocks.invoke}},dispatchEvent:vi.fn()});
 mocks.tasks.mockResolvedValue({sent:0,remaining:0});mocks.send.mockResolvedValue(2);
 mocks.invoke.mockImplementation(async name=>name==='sync_status'?{enabled:true,paused:false}:name==='sync_pending'?[]:name==='sync_scan'?{nextOffset:0,queued:0}:undefined);
});
afterEach(()=>vi.unstubAllGlobals());
describe('outgoing coordinator',()=>{
 it('delivers frozen requests before scanning and acknowledges exact receipts',async()=>{
  let reads=0;mocks.invoke.mockImplementation(async name=>name==='sync_status'?{enabled:true,paused:false}:name==='sync_pending'?(reads++===0?[op]:[]):name==='sync_scan'?{nextOffset:0,queued:0}:undefined);
  await expect(syncNow(owner,new AbortController().signal)).resolves.toEqual({sent:1,rejected:0,received:0,conflicts:0});
  expect(mocks.invoke).toHaveBeenCalledWith('outbound_ack',{owner,entity:'note',id:op.id,operation:op.operationId,revision:2});
  expect(mocks.tasks).toHaveBeenCalledTimes(2);
 });
 it('preserves an ambiguous operation and does not acknowledge or reject it',async()=>{
  mocks.invoke.mockImplementation(async name=>name==='sync_status'?{enabled:true,paused:false}:name==='sync_pending'?[op]:undefined);
  mocks.send.mockRejectedValue(new Error('connection'));
  await expect(syncNow(owner,new AbortController().signal)).rejects.toThrow('connection');
  expect(mocks.invoke.mock.calls.some(c=>['outbound_ack','outbound_reject'].includes(c[0]))).toBe(false);
 });
 it('marks only definitive rejection and continues the queue',async()=>{
  let reads=0;mocks.invoke.mockImplementation(async name=>name==='sync_status'?{enabled:true,paused:false}:name==='sync_pending'?(reads++===0?[op]:[]):name==='sync_scan'?{nextOffset:0,queued:0}:undefined);
  mocks.send.mockRejectedValue(new WorkspaceConflictError('revision'));
  await expect(syncNow(owner,new AbortController().signal)).resolves.toEqual({sent:0,rejected:1,received:0,conflicts:0});
  expect(mocks.invoke).toHaveBeenCalledWith('outbound_reject',{owner,entity:'note',id:op.id,operation:op.operationId});
 });
 it('does not run an automatic sweep when disabled or recovering',async()=>{
  mocks.invoke.mockResolvedValue({enabled:false,paused:false});
  await expect(syncNow(owner,new AbortController().signal,true)).rejects.toThrow('kapatıldı');
  mocks.invoke.mockResolvedValue({enabled:true,paused:true});
  await expect(syncNow(owner,new AbortController().signal)).rejects.toThrow('uzlaştırmayı');
  expect(mocks.send).not.toHaveBeenCalled();expect(mocks.tasks).not.toHaveBeenCalled();
 });
 it('shares one in-flight run for the same account',async()=>{
  let finish!:(value:unknown)=>void;mocks.invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const first=syncNow(owner,new AbortController().signal);
  const second=syncNow(owner,new AbortController().signal);expect(first).toBe(second);
  finish({enabled:true,paused:false});await first;expect(mocks.tasks).toHaveBeenCalledTimes(2);
 });
 it('downloads until the complete frontier using each committed cursor',async()=>{
  mocks.invoke.mockImplementation(async (name,args)=>name==='inbox_status'?{cursor:''}:name==='inbox_stage'?{cursor:args.page.nextCursor}:undefined);
  mocks.read.mockResolvedValueOnce({items:[{}],nextCursor:'one',hasMore:true}).mockResolvedValueOnce({items:[],nextCursor:'one',hasMore:false});
  await downloadCloud(owner,new AbortController().signal);
  expect(mocks.read.mock.calls.map(c=>c[1])).toEqual(['','one']);
  expect(mocks.invoke).toHaveBeenLastCalledWith('inbox_stage',{owner,expected:'one',page:{items:[],nextCursor:'one',hasMore:false}});
 });
});

it('shares the same operation between a manual button and the background runner',async()=>{
 let release!:(revision:number)=>void;mocks.send.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const first=deliverWorkspace(owner,op,new AbortController().signal);
 const second=deliverWorkspace(owner,op,new AbortController().signal);expect(first).toBe(second);
 release(2);await first;
 expect(mocks.send).toHaveBeenCalledTimes(1);
 expect(mocks.invoke.mock.calls.filter(c=>c[0]==='outbound_ack')).toHaveLength(1);
});

it('receives and merges before preparing any new outgoing operation',async()=>{
 mocks.read.mockResolvedValue({items:[],nextCursor:'fresh',hasMore:false});
 mocks.invoke.mockImplementation(async (name,args)=>{
  if(name==='sync_status')return {enabled:true,receiving:true,paused:false};
  if(name==='inbox_status')return {cursor:''};
  if(name==='inbox_stage')return {cursor:args.page.nextCursor};
  if(name==='merge_run')return {applied:1,conflicts:0,nextOffset:0};
  if(name==='sync_pending')return [];
  if(name==='sync_scan')return {nextOffset:0,queued:0};
 });
 await syncNow(owner,new AbortController().signal);
 const calls=mocks.invoke.mock.calls.map(c=>c[0]);
 expect(calls.indexOf('merge_run')).toBeLessThan(calls.indexOf('sync_scan'));
});
it('receive-only mode never sends or scans outgoing records',async()=>{
 mocks.read.mockResolvedValue({items:[],nextCursor:'fresh',hasMore:false});
 mocks.invoke.mockImplementation(async (name,args)=>name==='sync_status'?{enabled:false,receiving:true,paused:false}:name==='inbox_status'?{cursor:''}:name==='inbox_stage'?{cursor:args.page.nextCursor}:name==='merge_run'?{applied:2,conflicts:1,nextOffset:0}:undefined);
 await expect(syncNow(owner,new AbortController().signal,true)).resolves.toEqual({sent:0,rejected:0,received:2,conflicts:1});
 expect(mocks.tasks).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
});
