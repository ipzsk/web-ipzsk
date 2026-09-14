import React, {useEffect,useRef,useState} from 'react';
export function PromptEditor({value,onSave,onClose}:{value:string;onSave:(value:string)=>void;onClose:()=>void}){
 const [draft,setDraft]=useState(value);
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement;dialog.current?.showModal();return()=>previous?.focus();},[]);
 return <dialog ref={dialog} className="web-prompt-editor" aria-labelledby="prompt-editor-title" onCancel={event=>{event.preventDefault();onClose();}}>
  <header><div><h2 id="prompt-editor-title">编辑提示词</h2><p>修改主体、风格和画面细节，保存后再生成。</p></div><button type="button" className="web-button" aria-label="取消编辑" onClick={onClose}>取消</button></header>
  <textarea autoFocus aria-label="完整提示词" value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();onSave(draft);}}}/>
  <footer><span>{draft.length} 字 · ⌘ / Ctrl + Enter 保存</span><button type="button" className="web-button web-button-primary" onClick={()=>onSave(draft)}>保存提示词</button></footer>
 </dialog>;
}
