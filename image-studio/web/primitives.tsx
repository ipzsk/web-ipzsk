import React from 'react';
export const Button = React.forwardRef(function Button({variant='outline',size='md',className='',...props}:any,ref:any){
  return <button type="button" ref={ref} className={`web-button web-button-${variant} web-button-${size} ${className}`} {...props}/>;
});
export function Pill({variant,active,children,className='',...props}:any){return <button type="button" aria-pressed={active} data-active={active ? '' : undefined} className={`web-pill ${className}`} {...props}>{children}</button>;}
