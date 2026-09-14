// Private records are scoped to the authenticated account on this browser.
let database: Promise<IDBDatabase> | undefined;
function open():Promise<IDBDatabase> {
  return database ||= new Promise((resolve,reject) => {
    const request = indexedDB.open('ipzsk-image-studio',1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => {
      request.result.onversionchange = () => {request.result.close();database=undefined;};
      resolve(request.result);
    };
    request.onerror = () => {database=undefined;reject(request.error);};
  });
}
const recordKey = (userId:string,key:string):IDBValidKey => ['user',userId,key];
const requireUser = (userId:string|null):string => {
  if (!userId) throw new Error('请先登录账户，再保存作品或画布。');
  return userId;
};

export function createStorage(userId:string|null) {
  return {
    async read<T>(key:string,initial:T):Promise<T> {
      if (!userId) return initial;
      const db = await open();
      return new Promise((resolve,reject) => {
        const tx = db.transaction('records');
        const request = tx.objectStore('records').get(recordKey(userId,key));
        let value = initial;
        request.onsuccess = () => {value=request.result ?? initial;};
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    async write<T>(key:string,value:T):Promise<T> {
      const owner = requireUser(userId), db = await open();
      return new Promise((resolve,reject) => {
        const tx = db.transaction('records','readwrite');
        tx.objectStore('records').put(value,recordKey(owner,key));
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    async change<T>(key:string,initial:T,fn:(value:T)=>T):Promise<T> {
      const owner = requireUser(userId), db = await open();
      return new Promise((resolve,reject) => {
        // The read and write share one transaction, including across tabs.
        const tx = db.transaction('records','readwrite');
        const records = tx.objectStore('records');
        const request = records.get(recordKey(owner,key));
        let value:T, failure:unknown;
        request.onsuccess = () => {
          try {value=fn(request.result ?? initial);records.put(value,recordKey(owner,key));}
          catch (error) {failure=error;tx.abort();}
        };
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(failure ?? tx.error);
        tx.onabort = () => reject(failure ?? tx.error);
      });
    },
  };
}

const legacyKeys = ['history','gallery','canvases','favorites'];
const legacyOwnerKey:IDBValidKey = ['legacy','claimed-owner'];
const rows = (value:unknown):any[] => Array.isArray(value) ? value : [];

export async function legacyImportStatus(userId:string|null) {
  if (!userId) return {available:false,count:0,pendingTasks:0};
  const db = await open();
  return new Promise<{available:boolean;count:number;pendingTasks:number}>((resolve,reject) => {
    const tx = db.transaction('records'), records = tx.objectStore('records');
    let claimed = false, count = 0, pendingTasks = 0;
    const owner = records.get(legacyOwnerKey);
    owner.onsuccess = () => {claimed=Boolean(owner.result);};
    for (const key of legacyKeys) {
      const request = records.get(key);
      request.onsuccess = () => {count+=rows(request.result).length;};
    }
    const tasks = records.get('tasks');
    tasks.onsuccess = () => {pendingTasks=rows(tasks.result).filter(task=>['queued','running'].includes(task?.status)).length;};
    tx.oncomplete = () => resolve({available:!claimed && count>0,count,pendingTasks});
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Called only after the user explicitly claims ownership. Keep legacy data intact.
export async function importLegacyWorks(userId:string):Promise<number> {
  const ownerId = requireUser(userId), db = await open();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('records','readwrite'), records = tx.objectStore('records');
    const values = new Map<string,any>();
    let pending = 1 + legacyKeys.length*2, imported = 0, failure:unknown;
    const finishRead = () => {
      if (--pending) return;
      try {
        const claimed = values.get('owner');
        if (claimed) {
          if (claimed.userId!==ownerId) throw new Error('旧作品已由其他账户认领，无法再次导入。');
          return;
        }
        for (const key of legacyKeys) {
          const current = rows(values.get('current:'+key));
          const identity = (entry:any) => entry?.id ?? entry?.key;
          const existing = new Set(current.map(identity).filter(value=>value!=null));
          const incoming = rows(values.get('legacy:'+key)).filter(entry=>{
            const id=identity(entry);
            if (id!=null && existing.has(id)) return false;
            if (id!=null) existing.add(id);
            return true;
          });
          imported+=incoming.length;
          if (incoming.length) records.put([...current,...incoming],recordKey(ownerId,key));
        }
        records.put({userId:ownerId,importedAt:Date.now()},legacyOwnerKey);
      } catch (error) {failure=error;tx.abort();}
    };
    const get = (key:IDBValidKey,label:string) => {
      const request=records.get(key);
      request.onsuccess=()=>{values.set(label,request.result);finishRead();};
    };
    get(legacyOwnerKey,'owner');
    for (const key of legacyKeys) {get(key,'legacy:'+key);get(recordKey(ownerId,key),'current:'+key);}
    tx.oncomplete = () => resolve(imported);
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error);
  });
}
