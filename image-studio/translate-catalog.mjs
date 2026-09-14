// Build-time localization. Only Chinese prompts are shipped to the browser.
import fs from 'node:fs/promises';
const file = new URL('./assets/catalog.json', import.meta.url);
const catalog = JSON.parse(await fs.readFile(file, 'utf8'));
catalog.find(c=>c.id===30038).prompt=(await fs.readFile(new URL('./web/paper-art.zh.md',import.meta.url),'utf8')).trim();
catalog.find(c=>c.id===34).prompt=(await fs.readFile(new URL('./web/avatar-grid.zh.md',import.meta.url),'utf8')).trim();
const replacements=JSON.parse(await fs.readFile(new URL('./web/prompt-replacements.json',import.meta.url),'utf8'));
for(const c of catalog){
  // Bilingual source entries already contain a complete Chinese section.
  if(/^\[中文\]/.test(c.prompt)) c.prompt=c.prompt.split(/\n\s*\[(?:English|英文)\]/i)[0].replace(/^\[中文\]\s*/,'').trim();
  for(const [english,chinese] of Object.entries(replacements)) c.prompt=c.prompt.replaceAll(english,chinese);
  c.promptPreview=c.prompt.slice(0,160);
  delete c.originalPrompt;
}
const pending = catalog.filter(c => c.librarySource === 'canghe' && !c.localized && ((c.prompt.match(/[\u3400-\u9fff]/g)||[]).length < c.prompt.length * .15 || /[\u3040-\u30ff]/.test(c.prompt) || /[a-zA-Z][a-zA-Z ,.;:'’\n-]{180}/.test(c.prompt)));
const batches = [];
for (let i=0;i<pending.length;i+=4) batches.push(pending.slice(i,i+4));
let done=0;
// Serialize generated artifact writes so parallel translations cannot lose progress.
let writes=Promise.resolve();
await Promise.all(Array.from({length:4},async()=>{
  while(batches.length){
    const batch=batches.shift();
    try {
      const response=await fetch('https://www.ipzsk.com/api/prompts/translate?v=1&ids='+batch.map(c=>c.originalId).join(','),{signal:AbortSignal.timeout(125000)});
      const body=await response.json();
      if(!response.ok) throw new Error(body.error||response.status);
      for(const c of batch){
        const value=body.translations[String(c.originalId)];
        if(typeof value!=='string'||!/[\u3400-\u9fff]/.test(value)) throw new Error('Missing Chinese translation '+c.originalId);
        c.prompt=value;c.promptPreview=value.slice(0,160);c.localized=true;delete c.originalPrompt;
      }
      done+=batch.length;
      writes=writes.then(()=>fs.writeFile(file,JSON.stringify(catalog)));
      await writes;
      console.log('Localized',done,'/',pending.length);
    }catch(error){console.error('Failed',batch.map(c=>c.originalId).join(','),error.message);}
  }
}));
await fs.writeFile(file,JSON.stringify(catalog));
