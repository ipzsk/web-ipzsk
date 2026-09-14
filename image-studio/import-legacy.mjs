import fs from 'node:fs/promises';
// Run once before replacing the original page; outputs are public build assets.
const html=await fs.readFile('../image.html','utf8');
const legacy=JSON.parse(html.match(/<script id="punkData" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const canghe=await (await fetch('https://gpt-image2.canghe.ai/cases.json')).json();
const punk=JSON.parse(await fs.readFile('vendor/src/templates/punk-cases.json','utf8'));
const punkImages=JSON.parse(await fs.readFile('vendor/src/templates/punk-images.json','utf8'));
const categories={'Charts & Infographics':'图表与信息图','Products & E-commerce':'电商商品','Posters & Typography':'海报与排版','Documents & Publishing':'文档与出版','Illustration & Art':'插画与艺术','Characters & People':'人物与角色','Photography & Realism':'摄影与写实','Scenes & Storytelling':'场景与叙事','Brand & Logos':'品牌与标志','Architecture & Spaces':'建筑与空间','UI & Interfaces':'界面设计','History & Classical Themes':'历史与古典','Other Use Cases':'其他灵感'};
const styles=[];
for(const [index,item] of legacy.styles.entries()){
 const match=item.preview.match(/^data:([^;]+);base64,(.*)$/s);const ext=match[1].includes('jpeg')?'jpg':'png';
 const filename=`style-${item.id}.${ext}`;await fs.writeFile('assets/'+filename,Buffer.from(match[2],'base64'));
 styles.push({id:20000+index,title:item.name,prompt:item.styleAtom,category:item.mode==='avatar'?'头像风格':'封面风格',categoryZh:item.mode==='avatar'?'头像风格':'封面风格',styles:item.tags||[],scenes:[item.mode],image:'/image-studio/assets/'+filename,librarySource:'punk',sourceLabel:'adrianpunk · MIT',sourceUrl:'https://github.com/adrianpunk/Punk-Skill',githubUrl:'https://github.com/JayceHuang/dsh-imagegen',featured:true});
}
const cases=canghe.cases.map(item=>({...item,originalId:item.id,librarySource:'canghe',categoryZh:categories[item.category]||item.category,image:new URL(item.image,'https://gpt-image2.canghe.ai').href}));
for(const item of punk.cases){if(!styles.some(s=>s.title===item.title))styles.push({...item,id:30000+item.id,librarySource:'punk',categoryZh:item.category,image:punkImages[item.image]||'',featured:true});}
const unique=[...new Map([...styles,...cases].map(c=>[c.prompt,c])).values()];
await fs.writeFile('assets/catalog.json',JSON.stringify(unique));
console.log(`Imported ${unique.length} cases and ${legacy.styles.length} original style images`);
