export const IMAGE_MODELS=['gpt-image-2','gpt-image-2.5-flare','gemini-3.1-flash-image-preview'];
const value = {enabled:true, apiUrl:'/api/images/generations', imageModels:IMAGE_MODELS, promptModel:'gpt-5'};
const snapshot = {value};
export const scope = {getSnapshot:()=>snapshot,subscribe:()=>()=>{},getSecretSetSnapshot:()=>true,subscribeSecretSets:()=>()=>{}};
export function imageModelOptions(){return {models:IMAGE_MODELS};}
