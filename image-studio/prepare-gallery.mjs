// Offline asset preparation; sharp is a build tool, never a browser dependency.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const sharp=require(process.argv[2] || 'sharp');
const root=path.dirname(new URL(import.meta.url).pathname);
const file=path.join(root,'assets/catalog.json');
const cases=JSON.parse(await fs.readFile(file,'utf8'));
const categories={'封面风格':'封面与海报','封面':'封面与海报','Posters & Typography':'封面与海报','头像风格':'头像与人物','头像':'头像与人物','Characters & People':'头像与人物','Products & E-commerce':'电商与产品','Charts & Infographics':'信息图表','Documents & Publishing':'文档与出版','Illustration & Art':'插画与艺术','Scenes & Storytelling':'场景与故事','Photography & Realism':'摄影与写实','Brand & Logos':'品牌与标志','Architecture & Spaces':'建筑与空间','UI & Interfaces':'界面设计','History & Classical Themes':'历史与古典','Other Use Cases':'其他创意'};
await fs.mkdir(path.join(root,'assets/thumbs'),{recursive:true});
let index=0,done=0,totalOriginal=0,totalThumb=0;
await Promise.all(Array.from({length:6},async()=>{
 while(index<cases.length){
  const item=cases[index++];const target=path.join(root,`assets/thumbs/${item.id}.webp`);
  let source;
  if(item.image.startsWith('/image-studio/')) source=await fs.readFile(path.join(root,item.image.slice('/image-studio/'.length)));
  else {for(let attempt=0;attempt<3;attempt++){try{const response=await fetch(item.image,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Image HTTP '+response.status);source=Buffer.from(await response.arrayBuffer());break;}catch(e){if(attempt===2)throw e;}}}
  const thumb=await sharp(source).rotate().resize({width:420,height:420,fit:'inside',withoutEnlargement:true}).webp({quality:70,effort:4}).toBuffer();
  await fs.writeFile(target,thumb);
  totalOriginal+=source.length;totalThumb+=thumb.length;
  item.thumbnail=`/image-studio/assets/thumbs/${item.id}.webp`;
  item.category=categories[item.category] || item.category;
  item.categoryZh=item.category;
  if(++done%50===0)console.log('Prepared',done,'/',cases.length);
 }
}));
await fs.writeFile(file,JSON.stringify(cases));
console.log(JSON.stringify({count:done,originalBytes:totalOriginal,thumbnailBytes:totalThumb,reduction:1-totalThumb/totalOriginal}));
