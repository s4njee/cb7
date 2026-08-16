import{m as V,u as le,f as D,l as he,n as Q,i as ce,d as ee,b as f,C as x,a as p,h as g,s as te,y as C,o as I,c as b,e as de,T as ie,g as se,_ as y,j as S,k as B,p as $,q as j,r as q,t as ue,v as Z,w as z,x as pe,z as me,A as ge,B as fe,D as ye,E as ne,F as A,G as re,H as F,I as M,J as K,K as k,L as ve,M as be,N as Se,O as _e,P as N,Q as Pe,R as we,S as P,W as Ee,U as T,V as U,X as w,Y as ke,Z as R,$ as Ze}from"./TextReader-ra75oJ6O.js";import{a0 as rt,a1 as ot,a2 as at,a3 as lt,a4 as ht,a5 as ct,a6 as dt,a7 as ut,a8 as pt,a9 as mt,aa as gt,ab as ft,ac as yt,ad as vt,ae as bt,af as St,ag as _t,ah as Pt,ai as wt,aj as Et,ak as kt,al as Lt,am as Rt,an as Ot,ao as xt,ap as Ct,aq as It,ar as At,as as Ft,at as Tt,au as Ut,av as zt,aw as Mt,ax as Nt}from"./TextReader-ra75oJ6O.js";import"./index-DLNHbl76.js";let Le=class{constructor(e,t,i,s){this.injector=null,this.pub=e,this.item=i,this.burl=i.toURL(t)||"",this.cssProperties=s.cssProperties,this.injector=s.injector??null}async build(){if(!this.item.mediaType.isHTML)throw new Error(`Unsupported media type for WebPub: ${this.item.mediaType.string}`);return await this.buildHtmlFrame()}async buildHtmlFrame(){const e=await this.pub.get(this.item).readAsString();if(!e)throw new Error(`Failed reading item ${this.item.href}`);const t=new DOMParser().parseFromString(e,this.item.mediaType.string),i=t.querySelector("parsererror");if(i){const s=i.querySelector("div");throw new Error(`Failed parsing item ${this.item.href}: ${s?.textContent||i.textContent}`)}return this.injector&&await this.injector.injectForDocument(t,this.item),this.finalizeDOM(t,this.burl,this.item.mediaType,e,this.cssProperties)}setProperties(e,t){for(const i in e){const s=e[i];s&&t.documentElement.style.setProperty(i,s)}}finalizeDOM(e,t,i,s,n){if(!e)return"";if(n&&this.setProperties(n,e),e.body.querySelectorAll("img").forEach(l=>{l.setAttribute("fetchpriority","high")}),t!==void 0){const l=e.createElement("base");l.href=t,l.dataset.readium="true",e.head.firstChild.before(l)}let r;return i.string==="application/xhtml+xml"?r=new XMLSerializer().serializeToString(e):r=this.serializeAsHTML(e,s||""),URL.createObjectURL(new Blob([r],{type:i.isHTML?i.string:"application/xhtml+xml"}))}serializeAsHTML(e,t){const i=t.match(/<!DOCTYPE[^>]*>/i),s=i?i[0]+`
`:"";let n=e.documentElement.outerHTML;return s+n}},Re=class{constructor(e,t={},i=[],s=[]){this.timelineFragmentIds=s,this.hidden=!0,this.destroyed=!1,this.currModules=[],this.frame=document.createElement("iframe"),this.frame.classList.add("readium-navigator-iframe"),this.frame.style.visibility="hidden",this.frame.style.setProperty("aria-hidden","true"),this.frame.style.opacity="0",this.frame.style.position="absolute",this.frame.style.pointerEvents="none",this.frame.style.transition="visibility 0s, opacity 0.1s linear",this.frame.style.backgroundColor="#FFFFFF",this.source=e,this.contentProtectionConfig={...t},this.keyboardPeripheralsConfig=[...i]}async load(e=[]){return new Promise((t,i)=>{if(this.loader){const s=this.frame.contentWindow;if([...this.currModules].sort().join("|")===[...e].sort().join("|")){try{t(s)}catch{}return}this.comms?.halt(),this.loader.destroy(),this.loader=new V(s,e),this.currModules=e,this.comms=void 0;try{t(s)}catch{}return}this.frame.onload=()=>{const s=this.frame.contentWindow;this.loader=new V(s,e),this.currModules=e;try{t(s)}catch{}},this.frame.onerror=s=>{try{i(s)}catch{}},this.frame.contentWindow.location.replace(this.source)})}applyContentProtection(){this.comms||this.comms.resume(),this.comms.send("peripherals_protection",this.contentProtectionConfig),this.keyboardPeripheralsConfig&&this.keyboardPeripheralsConfig.length>0&&(this.conditionBridge?.destroy(),this.conditionBridge=new le(this.keyboardPeripheralsConfig,e=>{e.length>0&&this.comms.send("keyboard_peripherals",e)}),this.conditionBridge.setup()),this.contentProtectionConfig.monitorScrollingExperimental&&this.comms.send("scroll_protection",{}),this.contentProtectionConfig.protectPrinting?.disable&&this.comms.send("print_protection",this.contentProtectionConfig.protectPrinting)}async destroy(){this.conditionBridge?.destroy(),await this.hide(),this.loader?.destroy(),this.frame.remove(),this.destroyed=!0}async hide(){if(!this.destroyed){if(this.frame.style.visibility="hidden",this.frame.style.setProperty("aria-hidden","true"),this.frame.style.opacity="0",this.frame.style.pointerEvents="none",this.hidden=!0,this.frame.parentElement)return this.comms===void 0||!this.comms.ready?void 0:new Promise((e,t)=>{this.comms?.send("unfocus",void 0,i=>{this.comms?.halt(),e()})});this.comms?.halt()}}async show(e){if(this.destroyed)throw Error("Trying to show frame when it doesn't exist");if(!this.frame.parentElement)throw Error("Trying to show frame that is not attached to the DOM");return this.comms?this.comms.resume():this.comms=new D(this.frame.contentWindow,this.source),new Promise((t,i)=>{this.comms?.send("activate",void 0,()=>{this.comms?.send("focus",void 0,()=>{this.applyContentProtection(),this.timelineFragmentIds.length>0&&this.comms?.send("timeline_entries",this.timelineFragmentIds);const s=()=>{this.frame.style.removeProperty("visibility"),this.frame.style.removeProperty("aria-hidden"),this.frame.style.removeProperty("opacity"),this.frame.style.removeProperty("pointer-events"),this.hidden=!1,he.UA.WebKit&&this.comms?.send("force_webkit_recalc",void 0),t()};e!==void 0?this.comms?.send("go_progression",e,s):s()})})})}setCSSProperties(e){this.destroyed||!this.frame.contentWindow||(this.hidden&&(this.comms?this.comms?.resume():this.comms=new D(this.frame.contentWindow,this.source)),this.comms?.send("update_properties",e),this.hidden&&this.comms?.halt())}get iframe(){if(this.destroyed)throw Error("Trying to use frame when it doesn't exist");return this.frame}get realSize(){if(this.destroyed)throw Error("Trying to use frame client rect when it doesn't exist");return this.frame.getBoundingClientRect()}get window(){if(this.destroyed||!this.frame.contentWindow)throw Error("Trying to use frame window when it doesn't exist");return this.frame.contentWindow}get msg(){return this.comms}get ldr(){return this.loader}};class Oe{constructor(e,t,i,s={},n=[],r){this.pool=new Map,this.blobs=new Map,this.inprogress=new Map,this.pendingUpdates=new Map,this.injector=null,this.container=e,this.currentCssProperties=t,this.injector=i,this.contentProtectionConfig=s,this.keyboardPeripheralsConfig=[...n],this.getFragmentIds=r??(()=>[])}async destroy(){let e=this.inprogress.values(),t=e.next();const i=[];for(;t.value;)i.push(t.value),t=e.next();i.length>0&&await Promise.allSettled(i),this.inprogress.clear();let s=this.pool.values(),n=s.next();for(;n.value;)await n.value.destroy(),n=s.next();this.pool.clear(),this.blobs.forEach(r=>{this.injector?.releaseBlobUrl?.(r),URL.revokeObjectURL(r)}),this.blobs.clear(),this.injector?.dispose(),this.container.childNodes.forEach(r=>{(r.nodeType===Node.ELEMENT_NODE||r.nodeType===Node.TEXT_NODE)&&r.remove()})}async update(e,t,i){const s=e.readingOrder.items;let n=s.findIndex(h=>h.href===t.href);if(n<0)throw Error(`Locator not found in reading order: ${t.href}`);const r=s[n].href;this.inprogress.has(r)&&await this.inprogress.get(r);const l=new Promise(async(h,o)=>{const u=[],d=[];e.readingOrder.items.forEach((c,E)=>{E!==n&&E!==n-1&&E!==n+1&&(u.includes(c.href)||u.push(c.href)),E===n&&(d.includes(c.href)||d.push(c.href))}),u.forEach(async c=>{d.includes(c)||this.pool.has(c)&&(await this.pool.get(c)?.destroy(),this.pool.delete(c))}),this.currentBaseURL!==void 0&&e.baseURL!==this.currentBaseURL&&(this.blobs.forEach(c=>{this.injector?.releaseBlobUrl?.(c),URL.revokeObjectURL(c)}),this.blobs.clear()),this.currentBaseURL=e.baseURL;const v=async c=>{if(this.pendingUpdates.has(c)&&this.pendingUpdates.get(c)?.inPool===!1){const _=this.blobs.get(c);_&&(this.injector?.releaseBlobUrl?.(_),URL.revokeObjectURL(_),this.blobs.delete(c),this.pendingUpdates.delete(c))}if(this.pool.has(c)){const _=this.pool.get(c);if(!this.blobs.has(c))await _.destroy(),this.pool.delete(c),this.pendingUpdates.delete(c);else{await _.load(i);return}}const E=e.readingOrder.findWithHref(c);if(!E)return;if(!this.blobs.has(c)){const _=await new Le(e,this.currentBaseURL||"",E,{cssProperties:this.currentCssProperties,injector:this.injector}).build();this.blobs.set(c,_)}const O=new Re(this.blobs.get(c),this.contentProtectionConfig,this.keyboardPeripheralsConfig,this.getFragmentIds(c));c!==r&&await O.hide(),this.container.appendChild(O.iframe),await O.load(i),this.pool.set(c,O)};try{await Promise.all(d.map(c=>v(c)))}catch(c){o(c)}const m=this.pool.get(r);if(m?.source!==this._currentFrame?.source&&(await this._currentFrame?.hide(),m&&await m.load(i),m&&await m.show(t.locations.progression),this._currentFrame=m,m)){const c=this.container.ownerDocument.activeElement;c&&c.tagName==="IFRAME"&&c!==m.iframe&&m.iframe.focus({preventScroll:!0})}h()});this.inprogress.set(r,l),await l,this.inprogress.delete(r)}setCSSProperties(e){if(!((t,i)=>{const s=Object.keys(t),n=Object.keys(i);if(s.length!==n.length)return!1;for(const r of s)if(t[r]!==i[r])return!1;return!0})(this.currentCssProperties||{},e)){this.currentCssProperties=e,this.pool.forEach(t=>{t.setCSSProperties(e)});for(const t of this.blobs.keys())this.pendingUpdates.set(t,{inPool:this.pool.has(t)})}}get currentFrames(){return[this._currentFrame]}get currentBounds(){const e={x:0,y:0,width:0,height:0,top:0,right:0,bottom:0,left:0,toJSON(){return this}};return this.currentFrames.forEach(t=>{if(!t)return;const i=t.realSize;e.x=Math.min(e.x,i.x),e.y=Math.min(e.y,i.y),e.width+=i.width,e.height=Math.max(e.height,i.height),e.top=Math.min(e.top,i.top),e.right=Math.min(e.right,i.right),e.bottom=Math.min(e.bottom,i.bottom),e.left=Math.min(e.left,i.left)}),e}}class oe extends Q{constructor(e){super(),this.a11yNormalize=e.a11yNormalize??null,this.bodyHyphens=e.bodyHyphens??null,this.fontFamily=e.fontFamily??null,this.fontWeight=e.fontWeight??null,this.iOSPatch=e.iOSPatch??null,this.iPadOSPatch=e.iPadOSPatch??null,this.letterSpacing=e.letterSpacing??null,this.ligatures=e.ligatures??null,this.lineHeight=e.lineHeight??null,this.noRuby=e.noRuby??null,this.paraIndent=e.paraIndent??null,this.paraSpacing=e.paraSpacing??null,this.textAlign=e.textAlign??null,this.wordSpacing=e.wordSpacing??null,this.zoom=e.zoom??null}toCSSProperties(){const e={};return this.a11yNormalize&&(e["--USER__a11yNormalize"]=this.toFlag("a11y")),this.bodyHyphens&&(e["--USER__bodyHyphens"]=this.bodyHyphens),this.fontFamily&&(e["--USER__fontFamily"]=this.fontFamily),this.fontWeight!=null&&(e["--USER__fontWeight"]=this.toUnitless(this.fontWeight)),this.iOSPatch&&(e["--USER__iOSPatch"]=this.toFlag("iOSPatch")),this.iPadOSPatch&&(e["--USER__iPadOSPatch"]=this.toFlag("iPadOSPatch")),this.letterSpacing!=null&&(e["--USER__letterSpacing"]=this.toRem(this.letterSpacing)),this.ligatures&&(e["--USER__ligatures"]=this.ligatures),this.lineHeight!=null&&(e["--USER__lineHeight"]=this.toUnitless(this.lineHeight)),this.noRuby&&(e["--USER__noRuby"]=this.toFlag("noRuby")),this.paraIndent!=null&&(e["--USER__paraIndent"]=this.toRem(this.paraIndent)),this.paraSpacing!=null&&(e["--USER__paraSpacing"]=this.toRem(this.paraSpacing)),this.textAlign&&(e["--USER__textAlign"]=this.textAlign),this.wordSpacing!=null&&(e["--USER__wordSpacing"]=this.toRem(this.wordSpacing)),this.zoom!==null&&(e["--USER__zoom"]=this.toPercentage(this.zoom,!0)),e}}let xe=class extends Q{constructor(e){super(),this.experiments=e.experiments??null}toCSSProperties(){const e={};return this.experiments&&this.experiments.forEach(t=>{e["--RS__"+t]=ce[t].value}),e}};class Ce{constructor(e){this.rsProperties=e.rsProperties,this.userProperties=e.userProperties}update(e){e.experiments&&(this.rsProperties.experiments=e.experiments);const t={a11yNormalize:e.textNormalization,bodyHyphens:typeof e.hyphens!="boolean"?null:e.hyphens?"auto":"none",fontFamily:e.fontFamily,fontWeight:e.fontWeight,iOSPatch:e.iOSPatch,iPadOSPatch:e.iPadOSPatch,letterSpacing:e.letterSpacing,ligatures:typeof e.ligatures!="boolean"?null:e.ligatures?"common-ligatures":"none",lineHeight:e.lineHeight,noRuby:e.noRuby,paraIndent:e.paragraphIndent,paraSpacing:e.paragraphSpacing,textAlign:e.textAlign,wordSpacing:e.wordSpacing,zoom:e.zoom};this.userProperties=new oe(t)}}class L{constructor(e={}){this.fontFamily=ee(e.fontFamily),this.fontWeight=f(e.fontWeight,x.range),this.hyphens=p(e.hyphens),this.iOSPatch=p(e.iOSPatch),this.iPadOSPatch=p(e.iPadOSPatch),this.letterSpacing=g(e.letterSpacing),this.ligatures=p(e.ligatures),this.lineHeight=g(e.lineHeight),this.noRuby=p(e.noRuby),this.paragraphIndent=g(e.paragraphIndent),this.paragraphSpacing=g(e.paragraphSpacing),this.textAlign=te(e.textAlign,I),this.textNormalization=p(e.textNormalization),this.wordSpacing=g(e.wordSpacing),this.zoom=f(e.zoom,C.range)}static serialize(e){const{...t}=e;return JSON.stringify(t)}static deserialize(e){try{const t=JSON.parse(e);return new L(t)}catch(t){return console.error("Failed to deserialize preferences:",t),null}}merging(e){const t={...this};for(const i of Object.keys(e))e[i]!==void 0&&(t[i]=e[i]);return new L(t)}}let Ie=class{constructor(e){this.fontFamily=ee(e.fontFamily)||null,this.fontWeight=f(e.fontWeight,x.range)||null,this.hyphens=p(e.hyphens)??null,this.iOSPatch=e.iOSPatch===!1?!1:(b.OS.iOS||b.OS.iPadOS)&&b.iOSRequest==="mobile",this.iPadOSPatch=e.iPadOSPatch===!1?!1:b.OS.iPadOS&&b.iOSRequest==="desktop",this.letterSpacing=g(e.letterSpacing)||null,this.ligatures=p(e.ligatures)??null,this.lineHeight=g(e.lineHeight)||null,this.noRuby=p(e.noRuby)??!1,this.paragraphIndent=g(e.paragraphIndent)??null,this.paragraphSpacing=g(e.paragraphSpacing)??null,this.textAlign=te(e.textAlign,I)||null,this.textNormalization=p(e.textNormalization)??!1,this.wordSpacing=g(e.wordSpacing)||null,this.zoom=f(e.zoom,C.range)||1,this.experiments=de(e.experiments)??null}};class G{constructor(e,t,i){this.fontFamily=null,this.fontWeight=null,this.hyphens=null,this.iOSPatch=null,this.iPadOSPatch=null,this.letterSpacing=null,this.ligatures=null,this.lineHeight=null,this.noRuby=null,this.paragraphIndent=null,this.paragraphSpacing=null,this.textAlign=null,this.textNormalization=null,this.wordSpacing=null,i&&(this.fontFamily=e.fontFamily||t.fontFamily||null,this.fontWeight=e.fontWeight!==void 0?e.fontWeight:t.fontWeight!==void 0?t.fontWeight:null,this.hyphens=typeof e.hyphens=="boolean"?e.hyphens:t.hyphens??null,this.iOSPatch=e.iOSPatch===!1?!1:e.iOSPatch===!0?(b.OS.iOS||b.OS.iPadOS)&&b.iOSRequest==="mobile":t.iOSPatch,this.iPadOSPatch=e.iPadOSPatch===!1?!1:e.iPadOSPatch===!0?b.OS.iPadOS&&b.iOSRequest==="desktop":t.iPadOSPatch,this.letterSpacing=e.letterSpacing!==void 0?e.letterSpacing:t.letterSpacing!==void 0?t.letterSpacing:null,this.ligatures=typeof e.ligatures=="boolean"?e.ligatures:t.ligatures??null,this.lineHeight=e.lineHeight!==void 0?e.lineHeight:t.lineHeight!==void 0?t.lineHeight:null,this.noRuby=typeof e.noRuby=="boolean"?e.noRuby:t.noRuby??null,this.paragraphIndent=e.paragraphIndent!==void 0?e.paragraphIndent:t.paragraphIndent!==void 0?t.paragraphIndent:null,this.paragraphSpacing=e.paragraphSpacing!==void 0?e.paragraphSpacing:t.paragraphSpacing!==void 0?t.paragraphSpacing:null,this.textAlign=e.textAlign||t.textAlign||null,this.textNormalization=typeof e.textNormalization=="boolean"?e.textNormalization:t.textNormalization??null,this.wordSpacing=e.wordSpacing!==void 0?e.wordSpacing:t.wordSpacing!==void 0?t.wordSpacing:null),this.zoom=e.zoom!==void 0?e.zoom:t.zoom!==void 0?t.zoom:null,this.experiments=t.experiments||null}}class X{constructor(e,t,i){this.preferences=new L({...e}),this.settings=t,this.metadata=i}clear(){this.preferences=new L({fontFamily:null,fontWeight:null,hyphens:null,iOSPatch:null,iPadOSPatch:null,letterSpacing:null,ligatures:null,lineHeight:null,noRuby:null,paragraphIndent:null,paragraphSpacing:null,textAlign:null,textNormalization:null,wordSpacing:null,zoom:null})}updatePreference(e,t){this.preferences[e]=t}get isDisplayTransformable(){return this.metadata?.accessibility?.feature?.some(e=>e.value===ie.DISPLAY_TRANSFORMABILITY.value)??!1}get fontFamily(){return new se({initialValue:this.preferences.fontFamily,effectiveValue:this.settings.fontFamily||null,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("fontFamily",e??null)}})}get fontWeight(){return new y({initialValue:this.preferences.fontWeight,effectiveValue:this.settings.fontWeight||400,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("fontWeight",e??null)},supportedRange:x.range,step:x.step})}get hyphens(){return new S({initialValue:this.preferences.hyphens,effectiveValue:this.settings.hyphens||!1,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("hyphens",e??null)}})}get iOSPatch(){return new S({initialValue:this.preferences.iOSPatch,effectiveValue:this.settings.iOSPatch||!1,isEffective:!0,onChange:e=>{this.updatePreference("iOSPatch",e??null)}})}get iPadOSPatch(){return new S({initialValue:this.preferences.iPadOSPatch,effectiveValue:this.settings.iPadOSPatch||!1,isEffective:!0,onChange:e=>{this.updatePreference("iPadOSPatch",e??null)}})}get letterSpacing(){return new y({initialValue:this.preferences.letterSpacing,effectiveValue:this.settings.letterSpacing||0,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("letterSpacing",e??null)},supportedRange:B.range,step:B.step})}get ligatures(){return new S({initialValue:this.preferences.ligatures,effectiveValue:this.settings.ligatures||!0,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("ligatures",e??null)}})}get lineHeight(){return new y({initialValue:this.preferences.lineHeight,effectiveValue:this.settings.lineHeight,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("lineHeight",e??null)},supportedRange:$.range,step:$.step})}get noRuby(){return new S({initialValue:this.preferences.noRuby,effectiveValue:this.settings.noRuby||!1,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("noRuby",e??null)}})}get paragraphIndent(){return new y({initialValue:this.preferences.paragraphIndent,effectiveValue:this.settings.paragraphIndent||0,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("paragraphIndent",e??null)},supportedRange:j.range,step:j.step})}get paragraphSpacing(){return new y({initialValue:this.preferences.paragraphSpacing,effectiveValue:this.settings.paragraphSpacing||0,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("paragraphSpacing",e??null)},supportedRange:q.range,step:q.step})}get textAlign(){return new ue({initialValue:this.preferences.textAlign,effectiveValue:this.settings.textAlign||I.start,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("textAlign",e??null)},supportedValues:Object.values(I)})}get textNormalization(){return new S({initialValue:this.preferences.textNormalization,effectiveValue:this.settings.textNormalization||!1,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("textNormalization",e??null)}})}get wordSpacing(){return new y({initialValue:this.preferences.wordSpacing,effectiveValue:this.settings.wordSpacing||0,isEffective:this.isDisplayTransformable,onChange:e=>{this.updatePreference("wordSpacing",e??null)},supportedRange:Z.range,step:Z.step})}get zoom(){return new y({initialValue:this.preferences.zoom,effectiveValue:this.settings.zoom||1,isEffective:CSS.supports("zoom","1")??!1,onChange:e=>{this.updatePreference("zoom",e??null)},supportedRange:C.range,step:C.step})}}const Ae=`/*!
 * Readium CSS v.2.0.5
 * Copyright (c) 2017–2026. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 * Core maintainer: Jiminy Panoz <jiminy.panoz@edrlab.org> 
 * Contributors: 
 * Daniel Weck
 * Hadrien Gardeur
 * Innovimax
 * L. Le Meur
 * Mickaël Menu
 * k_taka
 */

:root[style*="--USER__textAlign"]{
  text-align:var(--USER__textAlign);
}

:root[style*="--USER__textAlign"] body,
:root[style*="--USER__textAlign"] p:not(
  blockquote p,
  figcaption p,
  header p,
  hgroup p,
  :root[style*="readium-experimentalHeaderFiltering-on"] p[class*="title"],
  :root[style*="readium-experimentalHeaderFiltering-on"] div:has(+ *) > h1 + p,
  :root[style*="readium-experimentalHeaderFiltering-on"] div:has(+ *) > p:has(+ h1)
),
:root[style*="--USER__textAlign"] li,
:root[style*="--USER__textAlign"] dd{
  text-align:var(--USER__textAlign) !important;
  -moz-text-align-last:auto !important;
  -epub-text-align-last:auto !important;
  text-align-last:auto !important;
}

:root[style*="--USER__bodyHyphens"]{
  -webkit-hyphens:var(--USER__bodyHyphens) !important;
  -moz-hyphens:var(--USER__bodyHyphens) !important;
  -ms-hyphens:var(--USER__bodyHyphens) !important;
  -epub-hyphens:var(--USER__bodyHyphens) !important;
  hyphens:var(--USER__bodyHyphens) !important;
}

:root[style*="--USER__bodyHyphens"] body,
:root[style*="--USER__bodyHyphens"] p,
:root[style*="--USER__bodyHyphens"] li,
:root[style*="--USER__bodyHyphens"] div,
:root[style*="--USER__bodyHyphens"] dd{
  -webkit-hyphens:var(--USER__bodyHyphens) !important;
  -moz-hyphens:var(--USER__bodyHyphens) !important;
  -ms-hyphens:var(--USER__bodyHyphens) !important;
  -epub-hyphens:var(--USER__bodyHyphens) !important;
  hyphens:var(--USER__bodyHyphens) !important;
}

:root[style*="--USER__fontFamily"]{
  font-family:var(--USER__fontFamily) !important;
}

:root[style*="--USER__fontFamily"] *{
  font-family:revert !important;
}

:root[style*="readium-a11y-on"]{
  font-style:normal !important;
  font-weight:normal !important;
}

:root[style*="readium-a11y-on"] body *:not(code):not(var):not(kbd):not(samp){
  font-family:inherit !important;
  font-style:inherit !important;
  font-weight:inherit !important;
}

:root[style*="readium-a11y-on"] body *:not(a){
  text-decoration:none !important;
}

:root[style*="readium-a11y-on"] body *{
  font-variant-caps:normal !important;
  font-variant-numeric:normal !important;
  font-variant-position:normal !important;
}

:root[style*="readium-a11y-on"] sup,
:root[style*="readium-a11y-on"] sub{
  font-size:1rem !important;
  vertical-align:baseline !important;
}

:root:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] body{
  zoom:var(--USER__zoom) !important;
}

:root[style*="readium-iOSPatch-on"][style*="--USER__zoom"] body{
  -webkit-text-size-adjust:var(--USER__zoom) !important;
}

@supports selector(figure:has(> img)){

  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] figure:has(> img),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] figure:has(> video),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] figure:has(> svg),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] figure:has(> canvas),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] figure:has(> iframe),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] figure:has(> audio),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] div:has(> img:only-child),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] div:has(> video:only-child),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] div:has(> svg:only-child),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] div:has(> canvas:only-child),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] div:has(> iframe:only-child),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] div:has(> audio:only-child),
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] table{
    zoom:calc(100% / var(--USER__zoom)) !important;
  }

  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] figcaption,
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] caption,
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] td,
  :root[style*="readium-experimentalZoom-on"]:not([style*="readium-iOSPatch-on"])[style*="--USER__zoom"] th{
    zoom:var(--USER__zoom) !important;
  }
}

:root[style*="--USER__lineHeight"]{
  line-height:var(--USER__lineHeight) !important;
}

:root[style*="--USER__lineHeight"] body,
:root[style*="--USER__lineHeight"] p,
:root[style*="--USER__lineHeight"] li,
:root[style*="--USER__lineHeight"] div{
  line-height:var(--USER__lineHeight) !important;
}

:root[style*="--USER__paraSpacing"] p{
  margin-top:var(--USER__paraSpacing) !important;
  margin-bottom:var(--USER__paraSpacing) !important;
}

:root[style*="--USER__paraIndent"] p:not(
  blockquote p,
  figcaption p,
  header p,
  hgroup p,
  :root[style*="readium-experimentalHeaderFiltering-on"] p[class*="title"],
  :root[style*="readium-experimentalHeaderFiltering-on"] div:has(+ *) > h1 + p,
  :root[style*="readium-experimentalHeaderFiltering-on"] div:has(+ *) > p:has(+ h1)
){
  text-indent:var(--USER__paraIndent) !important;
}

:root[style*="--USER__paraIndent"] p *{
  text-indent:0 !important;
}

:root[style*="--USER__wordSpacing"] h1,
:root[style*="--USER__wordSpacing"] h2,
:root[style*="--USER__wordSpacing"] h3,
:root[style*="--USER__wordSpacing"] h4,
:root[style*="--USER__wordSpacing"] h5,
:root[style*="--USER__wordSpacing"] h6,
:root[style*="--USER__wordSpacing"] p,
:root[style*="--USER__wordSpacing"] li,
:root[style*="--USER__wordSpacing"] div,
:root[style*="--USER__wordSpacing"] dt,
:root[style*="--USER__wordSpacing"] dd{
  word-spacing:var(--USER__wordSpacing) !important;
}

:root[style*="--USER__letterSpacing"] h1,
:root[style*="--USER__letterSpacing"] h2,
:root[style*="--USER__letterSpacing"] h3,
:root[style*="--USER__letterSpacing"] h4,
:root[style*="--USER__letterSpacing"] h5,
:root[style*="--USER__letterSpacing"] h6,
:root[style*="--USER__letterSpacing"] p,
:root[style*="--USER__letterSpacing"] li,
:root[style*="--USER__letterSpacing"] div,
:root[style*="--USER__letterSpacing"] dt,
:root[style*="--USER__letterSpacing"] dd{
  letter-spacing:var(--USER__letterSpacing) !important;
  font-variant:none !important;
}

:root[style*="--USER__fontWeight"] body{
  font-weight:var(--USER__fontWeight) !important;
}

:root[style*="--USER__fontWeight"] b,
:root[style*="--USER__fontWeight"] strong{
  font-weight:bolder;
}

:root[style*="--USER__fontWidth"] body{
  font-stretch:var(--USER__fontWidth) !important;
}

:root[style*="--USER__fontOpticalSizing"] body{
  font-optical-sizing:var(--USER__fontOpticalSizing) !important;
}

:root[style*="readium-noRuby-on"] body rt,
:root[style*="readium-noRuby-on"] body rp{
  display:none;
}

:root[style*="--USER__ligatures"]{
  font-variant-ligatures:var(--USER__ligatures) !important;
}

:root[style*="--USER__ligatures"] *{
  font-variant-ligatures:inherit !important;
}

:root[style*="readium-iPadOSPatch-on"] body{
  -webkit-text-size-adjust:none;
}

:root[style*="readium-iPadOSPatch-on"] p, 
:root[style*="readium-iPadOSPatch-on"] h1, 
:root[style*="readium-iPadOSPatch-on"] h2, 
:root[style*="readium-iPadOSPatch-on"] h3, 
:root[style*="readium-iPadOSPatch-on"] h4, 
:root[style*="readium-iPadOSPatch-on"] h5, 
:root[style*="readium-iPadOSPatch-on"] h6, 
:root[style*="readium-iPadOSPatch-on"] li, 
:root[style*="readium-iPadOSPatch-on"] th, 
:root[style*="readium-iPadOSPatch-on"] td, 
:root[style*="readium-iPadOSPatch-on"] dt, 
:root[style*="readium-iPadOSPatch-on"] dd, 
:root[style*="readium-iPadOSPatch-on"] pre, 
:root[style*="readium-iPadOSPatch-on"] address, 
:root[style*="readium-iPadOSPatch-on"] details, 
:root[style*="readium-iPadOSPatch-on"] summary,
:root[style*="readium-iPadOSPatch-on"] figcaption,
:root[style*="readium-iPadOSPatch-on"] div:not(:has(p, h1, h2, h3, h4, h5, h6, li, th, td, dt, dd, pre, address, aside, details, figcaption, summary)),
:root[style*="readium-iPadOSPatch-on"] aside:not(:has(p, h1, h2, h3, h4, h5, h6, li, th, td, dt, dd, pre, address, aside, details, figcaption, summary)){
  -webkit-text-zoom:reset;
}

:root[style*="readium-iPadOSPatch-on"] abbr, 
:root[style*="readium-iPadOSPatch-on"] b, 
:root[style*="readium-iPadOSPatch-on"] bdi, 
:root[style*="readium-iPadOSPatch-on"] bdo, 
:root[style*="readium-iPadOSPatch-on"] cite, 
:root[style*="readium-iPadOSPatch-on"] code, 
:root[style*="readium-iPadOSPatch-on"] dfn, 
:root[style*="readium-iPadOSPatch-on"] em, 
:root[style*="readium-iPadOSPatch-on"] i, 
:root[style*="readium-iPadOSPatch-on"] kbd, 
:root[style*="readium-iPadOSPatch-on"] mark, 
:root[style*="readium-iPadOSPatch-on"] q, 
:root[style*="readium-iPadOSPatch-on"] rp, 
:root[style*="readium-iPadOSPatch-on"] rt, 
:root[style*="readium-iPadOSPatch-on"] ruby, 
:root[style*="readium-iPadOSPatch-on"] s, 
:root[style*="readium-iPadOSPatch-on"] samp, 
:root[style*="readium-iPadOSPatch-on"] small, 
:root[style*="readium-iPadOSPatch-on"] span, 
:root[style*="readium-iPadOSPatch-on"] strong, 
:root[style*="readium-iPadOSPatch-on"] sub, 
:root[style*="readium-iPadOSPatch-on"] sup, 
:root[style*="readium-iPadOSPatch-on"] time, 
:root[style*="readium-iPadOSPatch-on"] u, 
:root[style*="readium-iPadOSPatch-on"] var{
  -webkit-text-zoom:normal;
}

:root[style*="readium-iPadOSPatch-on"] p:not(:has(b, cite, em, i, q, s, small, span, strong)):first-line{
  -webkit-text-zoom:normal;
}`,Fe=`// WebPub-specific setup - no execution blocking needed
window._readium_blockedEvents = [];
window._readium_blockEvents = false; // WebPub doesn't need event blocking
window._readium_eventBlocker = null;
`;function Te(a){const e=a.filter(n=>n.mediaType.isHTML).map(n=>n.href),t=e.length>0?e:[/\.html$/,/\.xhtml$/,/\/$/],i=[{id:"css-selector-generator",as:"script",target:"head",blob:new Blob([z(ge)],{type:"text/javascript"})},{id:"webpub-execution",as:"script",target:"head",blob:new Blob([z(Fe)],{type:"text/javascript"})}],s=[{id:"onload-proxy",as:"script",target:"head",blob:new Blob([z(me)],{type:"text/javascript"}),condition:n=>!!(n.querySelector("script")||n.querySelector("body[onload]:not(body[onload=''])"))},{id:"readium-css-webpub",as:"link",target:"head",blob:new Blob([pe(Ae)],{type:"text/css"}),rel:"stylesheet"}];return[{resources:t,prepend:i,append:s}]}const Ue=a=>({frameLoaded:a.frameLoaded||(()=>{}),positionChanged:a.positionChanged||(()=>{}),timelineItemChanged:a.timelineItemChanged||(()=>{}),tap:a.tap||(()=>!1),click:a.click||(()=>!1),zoom:a.zoom||(()=>{}),scroll:a.scroll||(()=>{}),customEvent:a.customEvent||(()=>{}),handleLocator:a.handleLocator||(()=>!1),textSelected:a.textSelected||(()=>{}),contentProtection:a.contentProtection||(()=>{}),contextMenu:a.contextMenu||(()=>{}),peripheral:a.peripheral||(()=>{})});function ze(a,e){return a.length===e.length&&a.every((t,i)=>t===e[i])}let Me=class extends fe{constructor(e,t,i,s=void 0,n={preferences:{},defaults:{}}){super(),this.currentIndex=0,this._visibleFragmentIds=[],this._notifiedVisibleFragmentIds=[],this._preferencesEditor=null,this._injector=null,this._isNavigating=!1,this._navigatorProtector=null,this._keyboardPeripheralsManager=null,this._suspiciousActivityListener=null,this._keyboardPeripheralListener=null,this._decorations=new Map,this._decorationObservers=new Map,this._decorationHoveredDecorations=new Map,this._decorationActivationState=new Map,this._decorationHoverState=new Map,this._decorationActivationConsumed=!1,this.webViewport={readingOrder:[],progressions:new Map,positions:null},this.pub=t,this.container=e,this.listeners=Ue(i),this._preferences=new L(n.preferences),this._defaults=new Ie(n.defaults),this._settings=new G(this._preferences,this._defaults,this.hasDisplayTransformability),this._css=new Ce({rsProperties:new xe({experiments:this._settings.experiments||null}),userProperties:new oe({zoom:this._settings.zoom})});const r=Te(t.readingOrder.items),l=n.injectables||{rules:[],allowedDomains:[]};if(this._injector=new ye({rules:[...r,...l.rules],allowedDomains:l.allowedDomains}),this._contentProtection=n.contentProtection||{},this._decoratorConfig=n.decoratorConfig||{},this._keyboardPeripherals=this.mergeKeyboardPeripherals(this._contentProtection,n.keyboardPeripherals||[]),(this._contentProtection.disableContextMenu||this._contentProtection.checkAutomation||this._contentProtection.checkIFrameEmbedding||this._contentProtection.monitorDevTools||this._contentProtection.protectPrinting?.disable)&&(this._navigatorProtector=new ne(this._contentProtection),this._suspiciousActivityListener=h=>{const{type:o,...u}=h.detail;o==="context_menu"?this.listeners.contextMenu(u):this.listeners.contentProtection(o,u)},window.addEventListener(A,this._suspiciousActivityListener)),this._keyboardPeripherals.length>0&&(this._keyboardPeripheralsManager=new re({keyboardPeripherals:this._keyboardPeripherals}),this._keyboardPeripheralListener=h=>{const o=h.detail;this.listeners.peripheral(o)},window.addEventListener(F,this._keyboardPeripheralListener)),s&&typeof s.copyWithLocations=="function"){this.currentLocation=s;const h=this.pub.readingOrder.findIndexWithHref(s.href);h>=0&&(this.currentIndex=h)}else this.currentLocation=this.createCurrentLocator()}async load(){await this.updateCSS(!1);const e=this.compileCSSProperties(this._css);this.framePool=new Oe(this.container,e,this._injector,this._contentProtection,this._keyboardPeripherals,t=>this.pub.timeline.segmentsForHref(t).flatMap(i=>i.references).map(i=>{const s=i.indexOf("#");return s>=0?i.slice(s+1):""}).filter(Boolean)),await this.apply()}get settings(){return Object.freeze({...this._settings})}get preferencesEditor(){return this._preferencesEditor===null&&(this._preferencesEditor=new X(this._preferences,this.settings,this.pub.metadata)),this._preferencesEditor}async submitPreferences(e){this._preferences=this._preferences.merging(e),await this.applyPreferences()}async applyPreferences(){this._settings=new G(this._preferences,this._defaults,this.hasDisplayTransformability),this._preferencesEditor!==null&&(this._preferencesEditor=new X(this._preferences,this.settings,this.pub.metadata)),await this.updateCSS(!0)}async updateCSS(e){this._css.update(this._settings),e&&await this.commitCSS(this._css)}compileCSSProperties(e){const t={};for(const[i,s]of Object.entries(e.rsProperties.toCSSProperties()))t[i]=s;for(const[i,s]of Object.entries(e.userProperties.toCSSProperties()))t[i]=s;return t}async commitCSS(e){const t=this.compileCSSProperties(e);this.framePool.setCSSProperties(t)}get _cframes(){return this.framePool.currentFrames}get hasDisplayTransformability(){return this.pub.metadata?.accessibility?.feature?.some(e=>e.value===ie.DISPLAY_TRANSFORMABILITY.value)??!1}eventListener(e,t){switch(e){case"_pong":this.listeners.frameLoaded(this.framePool.currentFrames[0].iframe.contentWindow),this.listeners.positionChanged(this.currentLocation),this._notifyTimelineChange(this.currentLocation),this._reapplyDecorationsToCurrentFrame();break;case"first_visible_locator":const i=k.deserialize(t);if(!i)break;this.currentLocation=new k({href:this.currentLocation.href,type:this.currentLocation.type,title:this.currentLocation.title,locations:i?.locations,text:i?.text}),this.listeners.positionChanged(this.currentLocation),this._notifyTimelineChange(this.currentLocation);break;case"text_selected":{const h=t;h.locator=new k({href:this.currentLocation.href,type:this.currentLocation.type,text:new ve({highlight:h.text})}),this.listeners.textSelected(h);break}case"decoration_activated":{this._handleDecorationActivated(t)&&(this._decorationActivationConsumed=!0);break}case"decoration_pointer_enter":this._handleDecorationPointerEnter(t);break;case"decoration_pointer_leave":this._handleDecorationPointerLeave(t);break;case"click":case"tap":if(this._decorationActivationConsumed){this._decorationActivationConsumed=!1;break}const s=t;if(s.interactiveElement){const h=new DOMParser().parseFromString(s.interactiveElement,"text/html").body.children[0];if(h.nodeType===h.ELEMENT_NODE&&h.nodeName==="A"&&h.hasAttribute("href")){const o=h.attributes.getNamedItem("href")?.value;if(o.startsWith("#"))this.go(this.currentLocation.copyWithLocations({fragments:[o.substring(1)]}),!1,()=>{});else if(o.startsWith("mailto:")||o.startsWith("tel:"))this.listeners.handleLocator(new M({href:o}).locator);else try{let u;if(o.startsWith("http://")||o.startsWith("https://"))u=o;else if(this.currentLocation.href.startsWith("http://")||this.currentLocation.href.startsWith("https://")){const v=new URL(this.currentLocation.href);u=new URL(o,v).href}else u=K.join(K.dirname(this.currentLocation.href),o);const d=this.pub.readingOrder.findWithHref(u);d?this.goLink(d,!1,()=>{}):(console.warn(`Internal link not found in readingOrder: ${u}`),this.listeners.handleLocator(new M({href:o}).locator))}catch(u){console.warn(`Couldn't resolve internal link for ${o}: ${u}`),this.listeners.handleLocator(new M({href:o}).locator)}}else console.log("Clicked on",h)}else if(e==="click"?this.listeners.click(s):this.listeners.tap(s))break;break;case"scroll":this.listeners.scroll(t);break;case"zoom":this.listeners.zoom(t);break;case"progress":this.syncLocation(t);break;case"content_protection":const n=t;this.listeners.contentProtection(n.type,n);break;case"context_menu":this.listeners.contextMenu(t);break;case"keyboard_peripherals":const r=t,l={...r,interactiveElement:void 0};r.interactiveElement&&(l.interactiveElement=new DOMParser().parseFromString(r.interactiveElement,"text/html").body.children[0]),this.listeners.peripheral(l);break;case"log":console.log(this.framePool.currentFrames[0]?.source?.split("/")[3],...t);break;default:this.listeners.customEvent(e,t);break}}determineModules(){const e=Ee.slice(),t=be(this.pub.metadata);return t==="cjk-vertical"||t==="mongolian-vertical"?e.map(i=>i==="webpub_snapper"?"cjk_vertical_snapper":i):e}attachListener(){this.framePool.currentFrames[0]?.msg&&(this.framePool.currentFrames[0].msg.listener=(e,t)=>{this.eventListener(e,t)}),this._reapplyDecorationsToCurrentFrame()}async apply(){if(await this.framePool.update(this.pub,this.currentLocation,this.determineModules()),this.attachListener(),this.pub.readingOrder.findIndexWithHref(this.currentLocation.href)<0)throw Error("Link for "+this.currentLocation.href+" not found!")}async destroy(){this._suspiciousActivityListener&&window.removeEventListener(A,this._suspiciousActivityListener),this._keyboardPeripheralListener&&window.removeEventListener(F,this._keyboardPeripheralListener),this._navigatorProtector?.destroy(),this._keyboardPeripheralsManager?.destroy(),await this.framePool?.destroy(),this._decorations.clear(),this._decorationObservers.clear(),this._decorationHoveredDecorations.clear(),this._decorationActivationState.clear(),this._decorationHoverState.clear()}supportsDecorationStyle(e){return Se(e,this._decoratorConfig.decorationTemplates)}registerDecorationObserver(e,t){this._decorationObservers.has(e)||this._decorationObservers.set(e,new Set),this._decorationObservers.get(e).add(t),t.onDecorationActivated&&(this._decorationActivationState.set(e,!0),this._sendDecorationActivatable(e,!0)),(t.onDecorationPointerEnter||t.onDecorationPointerLeave)&&(this._decorationHoverState.set(e,!0),this._sendDecorationHoverable(e,!0))}unregisterDecorationObserver(e){this._decorationObservers.forEach((t,i)=>{if(!t.has(e))return;t.delete(e);const s=[...t].some(r=>r.onDecorationActivated);this._decorationActivationState.has(i)&&!s&&(this._decorationActivationState.delete(i),this._sendDecorationActivatable(i,!1));const n=[...t].some(r=>r.onDecorationPointerEnter||r.onDecorationPointerLeave);this._decorationHoverState.has(i)&&!n&&(this._decorationHoverState.delete(i),this._sendDecorationHoverable(i,!1))})}_sendDecorationActivatable(e,t){const i=this.framePool?.currentFrames[0];i?.msg&&i.msg.send("decoration_activatable",{group:e,activatable:t})}_sendDecorationHoverable(e,t){const i=this.framePool?.currentFrames[0];i?.msg&&i.msg.send("decoration_hoverable",{group:e,hoverable:t})}applyDecorations(e,t){const i=this._decorations.get(t)??[],s=new Map(i.map(d=>[d.id,d])),n=new Map(e.map(d=>[d.id,d])),r=[],l=[],h=[];for(const[d,v]of s)n.has(d)?_e(v,n.get(d))||h.push(n.get(d)):r.push(d);for(const[d,v]of n)s.has(d)||l.push(v);this._decorations.set(t,e),this._sendDecorationOps(t,r,l,h,i);const o=this._decorationActivationState.get(t);o!==void 0&&this._sendDecorationActivatable(t,o);const u=this._decorationHoverState.get(t);u!==void 0&&this._sendDecorationHoverable(t,u)}_sendDecorationOps(e,t,i,s,n){const r=this.framePool?.currentFrames[0];if(!r?.msg)return;const l=this.currentLocation.href,h=new Map(n.map(o=>[o.id,o]));for(const o of t){const u=h.get(o);!u||u.locator.href!==l||r.msg.send("decorate",{group:e,action:"remove",decoration:{id:o}})}for(const o of i)o.locator.href===l&&r.msg.send("decorate",{group:e,action:"add",decoration:N(o,this._decoratorConfig.decorationTemplates)});for(const o of s)o.locator.href===l&&r.msg.send("decorate",{group:e,action:"update",decoration:N(o,this._decoratorConfig.decorationTemplates)})}_reapplyDecorationsToCurrentFrame(){const e=this.framePool?.currentFrames[0];if(!e?.msg)return;const t=this.currentLocation.href;for(const[i,s]of this._decorations){const n=s.filter(r=>r.locator.href===t);if(n.length!==0){e.msg.send("decorate",{group:i,action:"clear"});for(const r of n)e.msg.send("decorate",{group:i,action:"add",decoration:N(r,this._decoratorConfig.decorationTemplates)})}}for(const[i,s]of this._decorationActivationState)e.msg.send("decoration_activatable",{group:i,activatable:s});for(const[i,s]of this._decorationHoverState)e.msg.send("decoration_hoverable",{group:i,hoverable:s})}_handleDecorationActivated(e){const t=this._decorationObservers.get(e.group);if(!t||t.size===0)return!1;const i=(this._decorations.get(e.group)??[]).find(r=>r.id===e.decorationId);if(!i)return!1;const s={decoration:i,group:e.group,rect:e.rect,point:e.point};let n=!1;for(const r of t)r.onDecorationActivated?.(s)&&(n=!0);return n}_handleDecorationPointerEnter(e){const t=this._decorationObservers.get(e.group);if(!t||t.size===0)return;const i=(this._decorations.get(e.group)??[]).find(n=>n.id===e.decorationId);if(!i)return;this._decorationHoveredDecorations.set(e.group,i);const s={decoration:i,group:e.group,rect:e.rect,point:e.point};for(const n of t)n.onDecorationPointerEnter?.(s)}_handleDecorationPointerLeave(e){const t=this._decorationObservers.get(e.group);if(!t||t.size===0)return;const i=(this._decorations.get(e.group)??[]).find(n=>n.id===e.decorationId)??this._decorationHoveredDecorations.get(e.group);if(this._decorationHoveredDecorations.delete(e.group),!i)return;const s={decoration:i,group:e.group,rect:e.rect,point:e.point};for(const n of t)n.onDecorationPointerLeave?.(s)}async changeResource(e){if(e===0)return!1;const t=this.pub.readingOrder.findIndexWithHref(this.currentLocation.href),i=Math.max(0,Math.min(this.pub.readingOrder.items.length-1,t+e));return i===t?!1:(this.currentIndex=i,this.currentLocation=this.createCurrentLocator(),await this.apply(),!0)}updateViewport(e){this.webViewport.readingOrder=[],this.webViewport.progressions.clear(),this.webViewport.positions=null,this.currentLocation&&(this.webViewport.readingOrder.push(this.currentLocation.href),this.webViewport.progressions.set(this.currentLocation.href,e),this.currentLocation.locations?.position!==void 0&&(this.webViewport.positions=[this.currentLocation.locations.position]))}async syncLocation(e){const t=e;this.currentLocation&&(this.currentLocation=this.currentLocation.copyWithLocations({progression:t.start})),this.updateViewport(t),this.listeners.positionChanged(this.currentLocation);const i=t.fragmentId?this.currentLocation.copyWithLocations({fragments:[`#${t.fragmentId}`]}):this.currentLocation;this._visibleFragmentIds=t.visibleFragmentIds??[],this._notifyTimelineChange(i),await this.framePool.update(this.pub,this.currentLocation,this.determineModules())}goBackward(e,t){if(this._isNavigating){t(!1);return}this._isNavigating=!0,this.changeResource(-1).then(i=>{this._isNavigating=!1,t(i)})}goForward(e,t){if(this._isNavigating){t(!1);return}this._isNavigating=!0,this.changeResource(1).then(i=>{this._isNavigating=!1,t(i)})}get currentLocator(){return this.currentLocation}get viewport(){return this.webViewport}get isScrollStart(){const e=this.viewport.readingOrder[0];return this.viewport.progressions.get(e)?.start===0}get isScrollEnd(){const e=this.viewport.readingOrder[this.viewport.readingOrder.length-1];return this.viewport.progressions.get(e)?.end===1}get canGoBackward(){const e=this.pub.readingOrder.items[0]?.href;return!(this.viewport.progressions.has(e)&&this.viewport.progressions.get(e)?.start===0)}get canGoForward(){const e=this.pub.readingOrder.items[this.pub.readingOrder.items.length-1]?.href;return!(this.viewport.progressions.has(e)&&this.viewport.progressions.get(e)?.end===1)}get readingProgression(){return this.pub.metadata.effectiveReadingProgression}get publication(){return this.pub}get timeline(){const e=this.pub.timeline;return this._wrappedTimeline||(this._wrappedTimeline=new Proxy(e,{get:(t,i)=>{if(i!=="navigableFrom"){const s=Reflect.get(t,i,t);return typeof s=="function"?s.bind(t):s}return s=>{const n=this._visibleFragmentIds;let r=(n.length?t.locate(this.currentLocation.copyWithLocations({fragments:[`#${n[0]}`]})):void 0)??s;const l=(n.length?t.locate(this.currentLocation.copyWithLocations({fragments:[`#${n[n.length-1]}`]})):void 0)??s;if(this.isScrollStart){const u=t.ancestors(r).find(d=>d.references.includes(this.currentLocation.href));u&&(r=u)}const h=t.navigableFrom(r).previous,o=t.navigableFrom(l).next;return{previous:h,next:o}}}})),this._wrappedTimeline}async loadLocator(e,t){let i=!1,s=Pe(e.locations);if(e.text?.highlight?i=await new Promise((l,h)=>{this.framePool.currentFrames[0].msg.send("go_text",s?[e.text?.serialize(),s]:e.text?.serialize(),o=>l(o))}):s&&(i=await new Promise((l,h)=>{this.framePool.currentFrames[0].msg.send("go_text",["",s],o=>l(o))})),i){t(i);return}const n=we(e.locations);if(n&&(i=await new Promise((l,h)=>{this.framePool.currentFrames[0].msg.send("go_id",n,o=>l(o))})),i){t(i);return}const r=e?.locations?.progression;r&&r>0?i=await new Promise((l,h)=>{this.framePool.currentFrames[0].msg.send("go_progression",r,o=>l(o))}):i=!0,t(i)}go(e,t,i){const s=e.href.split("#")[0];if(!this.pub.readingOrder.findWithHref(s))return i(this.listeners.handleLocator(e));const n=this.pub.readingOrder.findIndexWithHref(s);if(n>=0&&(this.currentIndex=n),this._isNavigating){i(!1);return}this._isNavigating=!0,this.currentLocation=this.createCurrentLocator(),this.apply().then(()=>this.loadLocator(e,r=>{this._isNavigating=!1,i(r)})).then(()=>{this.attachListener()})}goLink(e,t,i){return this.go(e.locator,t,i)}createCurrentLocator(){const e=this.pub.readingOrder.items[this.currentIndex];if(!e)throw new Error("No current resource available");const t=this.currentLocation&&this.currentLocation.href===e.href&&this.currentLocation.locations.progression?this.currentLocation.locations.progression:0;return this.pub.manifest.locatorFromLink(e)||new k({href:e.href,type:e.type||"text/html",locations:new P({fragments:[],progression:t,position:this.currentIndex+1})})}_notifyTimelineChange(e){const t=this.timeline.locate(e),i=!ze(this._visibleFragmentIds,this._notifiedVisibleFragmentIds);(t!==this._currentTimelineItem||i)&&(this._currentTimelineItem=t,this._notifiedVisibleFragmentIds=this._visibleFragmentIds,this.listeners.timelineItemChanged(t))}};const et=Me,Ne=`// PreservePitchProcessor.js
// AudioWorklet processor for pitch preservation via pitch shifting.
//
// Architecture:
//   - Overlap-add (OLA) phase vocoder with an iterative in-place Cooley-Tukey FFT/IFFT.
//   - All intermediate buffers are pre-allocated in the constructor; the hot path
//     (process → _processBuffer → _fft) is allocation-free and GC-safe.
//   - An output ring buffer decouples OLA processing (fires every hopSize input
//     samples) from the Web Audio render quantum (128 frames), so process() always
//     fills outputChannel completely.

class PreservePitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize  = 1024;
    this.hopSize     = 256;
    this.overlap     = this.bufferSize - this.hopSize;
    this.pitchFactor = 1.0;

    // Sliding input window (always holds the last bufferSize samples)
    this.inputBuffer = new Float32Array(this.bufferSize);
    this.inputFill   = 0;   // samples loaded during startup (saturates at bufferSize)
    this.hopAccum    = 0;   // new samples since last OLA step; triggers a step at hopSize

    // OLA output accumulator: overlap-add results accumulate here; hopSize samples
    // are drained to the ring buffer and the remainder shifts down each OLA step.
    this.olaBuffer = new Float32Array(this.bufferSize);

    // Output FIFO ring buffer — power-of-2 size for allocation-free modulo wrapping.
    this._ringSize  = 4096;
    this._ring      = new Float32Array(this._ringSize);
    this._ringMask  = this._ringSize - 1;
    this._ringWrite = 0;
    this._ringRead  = 0;
    this._ringAvail = 0;

    // Hann window (pre-computed, never mutated)
    this.window = new Float32Array(this.bufferSize);
    for (let i = 0; i < this.bufferSize; i++) {
      this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / this.bufferSize));
    }

    // Pre-allocated FFT work buffers — never re-created in the hot path
    this._re        = new Float64Array(this.bufferSize);
    this._im        = new Float64Array(this.bufferSize);
    this._shiftedRe = new Float64Array(this.bufferSize);
    this._shiftedIm = new Float64Array(this.bufferSize);

    this.port.onmessage = (event) => {
      if (event.data.type === 'setPitchFactor') {
        this.pitchFactor = event.data.factor;
      }
    };
  }

  process(inputs, outputs) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;
    const inCh  = input[0];
    const outCh = output[0];
    if (!inCh || !outCh) return true;

    const newCount = inCh.length; // always 128 under normal Web Audio conditions

    // --- 1. Push new samples into the sliding input window ---
    if (this.inputFill < this.bufferSize) {
      // Startup: fill the window until we have a full bufferSize frame.
      // Since bufferSize (1024) is an exact multiple of the render quantum (128)
      // this branch always copies exactly newCount samples.
      this.inputBuffer.set(inCh, this.inputFill);
      this.inputFill += newCount;
    } else {
      // Steady state: slide left by newCount, append the new quantum at the end.
      this.inputBuffer.copyWithin(0, newCount);
      this.inputBuffer.set(inCh, this.bufferSize - newCount);
    }
    this.hopAccum += newCount;

    // --- 2. Run OLA step(s) whenever hopAccum reaches hopSize ---
    // During startup we skip processing until a full window is available.
    while (this.inputFill >= this.bufferSize && this.hopAccum >= this.hopSize) {
      this.hopAccum -= this.hopSize;
      this._processBuffer(); // drains hopSize samples into _ring
    }

    // --- 3. Drain output ring into outputChannel ---
    // Output silence during the initial buffering latency (bufferSize samples ≈ 23 ms
    // at 44100 Hz).  Once the ring has data it stays ahead of demand.
    if (this._ringAvail >= newCount) {
      for (let i = 0; i < newCount; i++) {
        outCh[i] = this._ring[this._ringRead];
        this._ringRead = (this._ringRead + 1) & this._ringMask;
      }
      this._ringAvail -= newCount;
    } else {
      outCh.fill(0);
    }

    return true;
  }

  _processBuffer() {
    const N         = this.bufferSize;
    const re        = this._re;
    const im        = this._im;
    const shiftedRe = this._shiftedRe;
    const shiftedIm = this._shiftedIm;
    const win       = this.window;

    // Load windowed input into real part; zero imaginary part
    for (let i = 0; i < N; i++) {
      re[i] = this.inputBuffer[i] * win[i];
      im[i] = 0;
    }

    this._fft(re, im, false);

    // Spectral pitch shift: map bin k → round(k * factor)
    shiftedRe.fill(0);
    shiftedIm.fill(0);
    const half   = N >> 1;
    const factor = this.pitchFactor;
    for (let k = 0; k <= half; k++) {
      const newK = Math.round(k * factor);
      if (newK <= half) {
        shiftedRe[newK] += re[k];
        shiftedIm[newK] += im[k];
        // Restore conjugate symmetry so the IFFT yields a real-valued signal
        if (newK > 0 && newK < half) {
          shiftedRe[N - newK] =  shiftedRe[newK];
          shiftedIm[N - newK] = -shiftedIm[newK];
        }
      }
    }

    this._fft(shiftedRe, shiftedIm, true); // in-place IFFT

    // Overlap-add into olaBuffer
    for (let i = 0; i < N; i++) {
      this.olaBuffer[i] += shiftedRe[i] * win[i];
    }

    // Push hopSize output samples to the ring buffer
    for (let i = 0; i < this.hopSize; i++) {
      this._ring[this._ringWrite] = this.olaBuffer[i];
      this._ringWrite = (this._ringWrite + 1) & this._ringMask;
    }
    this._ringAvail += this.hopSize;

    // Shift the OLA accumulator left by hopSize; clear the vacated tail
    this.olaBuffer.copyWithin(0, this.hopSize);
    this.olaBuffer.fill(0, this.bufferSize - this.hopSize);
  }

  /**
   * In-place iterative Cooley-Tukey FFT / IFFT.
   * Operates entirely on the caller-supplied Float64Arrays — no allocation.
   *
   * @param {Float64Array} re      Real parts (mutated in place)
   * @param {Float64Array} im      Imaginary parts (mutated in place)
   * @param {boolean}      inverse true → IFFT (divides by N), false → FFT
   */
  _fft(re, im, inverse) {
    const N = re.length;

    // Bit-reversal permutation
    let j = 0;
    for (let i = 1; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let tmp;
        tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }

    // Butterfly stages — O(N log N), no allocation
    const sign = inverse ? 1 : -1;
    for (let len = 2; len <= N; len <<= 1) {
      const halfLen = len >> 1;
      const ang     = sign * Math.PI / halfLen;
      const wBaseRe = Math.cos(ang);
      const wBaseIm = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let wRe = 1, wIm = 0;
        for (let k = 0; k < halfLen; k++) {
          const uRe = re[i + k];
          const uIm = im[i + k];
          const vRe = re[i + k + halfLen] * wRe - im[i + k + halfLen] * wIm;
          const vIm = re[i + k + halfLen] * wIm + im[i + k + halfLen] * wRe;
          re[i + k]           = uRe + vRe;
          im[i + k]           = uIm + vIm;
          re[i + k + halfLen] = uRe - vRe;
          im[i + k + halfLen] = uIm - vIm;
          const newWRe = wRe * wBaseRe - wIm * wBaseIm;
          wIm = wRe * wBaseIm + wIm * wBaseRe;
          wRe = newWRe;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < N; i++) {
        re[i] /= N;
        im[i] /= N;
      }
    }
  }
}

registerProcessor('preserve-pitch-processor', PreservePitchProcessor);
`;class W{constructor(e){this.workletNode=null,this.url=null,this.ctx=e}static async createWorklet(e){const{ctx:t,pitchFactor:i,modulePath:s}=e,n=new W(t);try{if(s)await t.audioWorklet.addModule(s);else{const r=new Blob([Ne],{type:"text/javascript"});n.url=URL.createObjectURL(r),await t.audioWorklet.addModule(n.url)}}catch(r){throw n.destroy(),new Error(`Error adding module: ${r}`)}try{n.workletNode=new AudioWorkletNode(t,"preserve-pitch-processor"),i&&n.updatePitchFactor(i)}catch(r){throw n.destroy(),new Error(`Error creating worklet node: ${r}`)}return n}updatePitchFactor(e){this.workletNode&&this.workletNode.port.postMessage({type:"setPitchFactor",factor:e})}destroy(){this.workletNode&&(this.workletNode.disconnect(),this.workletNode=null),this.url&&(URL.revokeObjectURL(this.url),this.url=null)}}class He{constructor(e){this.audioContext=null,this.sourceNode=null,this.gainNode=null,this.listeners={},this.isMutedValue=!1,this.isPlayingValue=!1,this.isPausedValue=!1,this.isLoadingValue=!1,this.isLoadedValue=!1,this.isEndedValue=!1,this.isStoppedValue=!1,this.worklet=null,this.webAudioActive=!1,this.boundOnCanPlayThrough=this.onCanPlayThrough.bind(this),this.boundOnTimeUpdate=this.onTimeUpdate.bind(this),this.boundOnError=this.onError.bind(this),this.boundOnEnded=this.onEnded.bind(this),this.boundOnStalled=this.onStalled.bind(this),this.boundOnEmptied=this.onEmptied.bind(this),this.boundOnSuspend=this.onSuspend.bind(this),this.boundOnWaiting=this.onWaiting.bind(this),this.boundOnLoadedMetadata=this.onLoadedMetadata.bind(this),this.boundOnSeeking=this.onSeeking.bind(this),this.boundOnSeeked=this.onSeeked.bind(this),this.boundOnPlay=this.onPlay.bind(this),this.boundOnPlaying=this.onPlaying.bind(this),this.boundOnPause=this.onPause.bind(this),this.boundOnProgress=this.onProgress.bind(this),this.playback=e.playback,this.mediaElement=document.createElement("audio"),this.mediaElement.addEventListener("canplaythrough",this.boundOnCanPlayThrough),this.mediaElement.addEventListener("timeupdate",this.boundOnTimeUpdate),this.mediaElement.addEventListener("error",this.boundOnError),this.mediaElement.addEventListener("ended",this.boundOnEnded),this.mediaElement.addEventListener("stalled",this.boundOnStalled),this.mediaElement.addEventListener("emptied",this.boundOnEmptied),this.mediaElement.addEventListener("suspend",this.boundOnSuspend),this.mediaElement.addEventListener("waiting",this.boundOnWaiting),this.mediaElement.addEventListener("loadedmetadata",this.boundOnLoadedMetadata),this.mediaElement.addEventListener("seeking",this.boundOnSeeking),this.mediaElement.addEventListener("seeked",this.boundOnSeeked),this.mediaElement.addEventListener("play",this.boundOnPlay),this.mediaElement.addEventListener("playing",this.boundOnPlaying),this.mediaElement.addEventListener("pause",this.boundOnPause),this.mediaElement.addEventListener("progress",this.boundOnProgress),this.mediaElement.currentTime=this.playback.state.currentTime}on(e,t){this.listeners[e]||(this.listeners[e]=[]),this.listeners[e].push(t)}off(e,t){this.listeners[e]&&(this.listeners[e]=this.listeners[e].filter(i=>i!==t))}async ensureAudioContextRunning(){this.audioContext||(this.audioContext=new AudioContext),this.audioContext.state==="suspended"&&await this.audioContext.resume()}getOrCreateAudioContext(){return this.audioContext||(this.audioContext=new AudioContext),this.audioContext}onTimeUpdate(){this.emit("timeupdate",this.mediaElement.currentTime)}onCanPlayThrough(){this.isLoadingValue=!1,this.isLoadedValue=!0,this.emit("canplaythrough",null)}onError(){console.error("Error loading media element"),this.emit("error",this.mediaElement.error)}onEnded(){this.isPlayingValue=!1,this.isPausedValue=!1,this.isEndedValue=!0,this.emit("ended",null)}onStalled(e){this.emit("stalled",e)}onEmptied(e){this.emit("emptied",e)}onSuspend(e){this.emit("suspend",e)}onWaiting(e){this.emit("waiting",e)}onLoadedMetadata(e){this.emit("loadedmetadata",e)}onSeeking(e){this.emit("seeking",e)}onSeeked(e){this.emit("seeked",e)}onPlay(){this.emit("play",null)}onPlaying(){this.emit("playing",null)}onPause(){this.emit("pause",null)}onProgress(){this.emit("progress",this.mediaElement.seekable)}emit(e,t){this.listeners[e]&&this.listeners[e].forEach(i=>i(t))}async play(){if(!this.isPlayingValue)try{this.audioContext&&await this.ensureAudioContextRunning(),await this.mediaElement.play(),this.isPlayingValue=!0,this.isPausedValue=!1,this.isStoppedValue=!1}catch(e){if(e?.name==="AbortError")return;console.error("error trying to play media element",e),this.emit("error",e)}}pause(){this.mediaElement.pause(),this.isPlayingValue=!1,this.isPausedValue=!0}stop(){this.mediaElement.pause(),this.mediaElement.currentTime=0,this.isPlayingValue=!1,this.isPausedValue=!1,this.isStoppedValue=!0}setVolume(e){const t=Math.max(0,Math.min(1,e));this.gainNode?(this.mediaElement.volume=1,this.gainNode.gain.value=t):this.mediaElement.volume=t,this.isMutedValue=t===0}skip(e){const t=this.mediaElement.duration;if(!isFinite(t))return;const i=this.mediaElement.currentTime+e;i<0?this.mediaElement.currentTime=0:i>t?this.mediaElement.currentTime=t:this.mediaElement.currentTime=i}currentTime(){return this.mediaElement.currentTime}duration(){return this.mediaElement.duration}isPlaying(){return this.isPlayingValue}isPaused(){return this.isPausedValue}isStopped(){return this.isStoppedValue}isLoading(){return this.isLoadingValue}isLoaded(){return this.isLoadedValue}isEnded(){return this.isEndedValue}isMuted(){return this.isMutedValue}setPlaybackRate(e,t){this.mediaElement.playbackRate=e,t?"preservesPitch"in this.mediaElement?this.mediaElement.preservesPitch=!0:this.activateWebAudio().then(()=>{this.worklet?this.worklet.updatePitchFactor(1/e):W.createWorklet({ctx:this.getOrCreateAudioContext(),pitchFactor:1}).then(i=>{this.sourceNode&&this.sourceNode.disconnect(),this.worklet=i,this.sourceNode?.connect(this.worklet.workletNode),this.worklet.workletNode.connect(this.gainNode),this.worklet.updatePitchFactor(1/e)}).catch(i=>{console.warn("Failed to create preserve pitch worklet",i)})}).catch(i=>{console.warn("Web Audio unavailable, playing without pitch correction:",i)}):("preservesPitch"in this.mediaElement&&(this.mediaElement.preservesPitch=!1),this.worklet&&(this.worklet.destroy(),this.worklet=null,this.webAudioActive&&this.sourceNode&&(this.sourceNode.disconnect(),this.sourceNode.connect(this.gainNode))))}async activateWebAudio(){if(this.webAudioActive)return;const e=this.mediaElement.src;if(!e)return;const t=this.mediaElement.currentTime,i=this.isPlayingValue;i&&(this.mediaElement.pause(),this.isPlayingValue=!1),this.mediaElement.crossOrigin="anonymous",this.mediaElement.src=e,this.mediaElement.load();try{await new Promise((n,r)=>{const l=()=>{this.mediaElement.removeEventListener("canplaythrough",l),this.mediaElement.removeEventListener("error",h),n()},h=()=>{this.mediaElement.removeEventListener("canplaythrough",l),this.mediaElement.removeEventListener("error",h),r(new Error("Audio reload with CORS failed — server may not send Access-Control-Allow-Origin"))};this.mediaElement.addEventListener("canplaythrough",l),this.mediaElement.addEventListener("error",h)})}catch(n){throw this.mediaElement.removeAttribute("crossorigin"),this.mediaElement.src=e,this.mediaElement.load(),i?(await new Promise(r=>{const l=()=>{this.mediaElement.removeEventListener("canplaythrough",l),r()};this.mediaElement.addEventListener("canplaythrough",l)}),this.mediaElement.currentTime=t,await this.mediaElement.play(),this.isPlayingValue=!0,this.isPausedValue=!1):this.mediaElement.currentTime=t,n}this.mediaElement.currentTime=t,this.sourceNode=new MediaElementAudioSourceNode(this.getOrCreateAudioContext(),{mediaElement:this.mediaElement});const s=this.getOrCreateAudioContext();this.gainNode=s.createGain(),this.gainNode.gain.value=this.mediaElement.volume,this.mediaElement.volume=1,this.sourceNode.connect(this.gainNode),this.gainNode.connect(s.destination),this.webAudioActive=!0,i&&(await this.ensureAudioContextRunning(),await this.mediaElement.play(),this.isPlayingValue=!0,this.isPausedValue=!1)}get isWebAudioActive(){return this.webAudioActive}tearDownWebAudio(){this.worklet&&(this.worklet.destroy(),this.worklet=null),this.sourceNode&&(this.sourceNode.disconnect(),this.sourceNode=null),this.gainNode&&(this.mediaElement.volume=this.gainNode.gain.value,this.gainNode.disconnect(),this.gainNode=null),this.webAudioActive=!1}changeSrc(e){if(this.mediaElement.src!==e)if(this.mediaElement.pause(),this.isPlayingValue=!1,this.isPausedValue=!1,this.isLoadedValue=!1,this.isLoadingValue=!0,this.isEndedValue=!1,this.webAudioActive){this.mediaElement.crossOrigin="anonymous",this.mediaElement.src=e,this.mediaElement.load();const t=()=>{s()},i=()=>{s(),console.warn("CORS reload failed for new track — disabling Web Audio graph:",e),this.tearDownWebAudio(),this.mediaElement.removeAttribute("crossorigin"),this.mediaElement.src=e,this.mediaElement.load()},s=()=>{this.mediaElement.removeEventListener("canplaythrough",t),this.mediaElement.removeEventListener("error",i)};this.mediaElement.addEventListener("canplaythrough",t),this.mediaElement.addEventListener("error",i)}else this.mediaElement.src=e,this.mediaElement.load()}getMediaElement(){return this.mediaElement}}let H=class ae{constructor(e={}){this.volume=f(e.volume,T.range),this.playbackRate=f(e.playbackRate,U.range),this.preservePitch=p(e.preservePitch),this.skipBackwardInterval=f(e.skipBackwardInterval,w.range),this.skipForwardInterval=f(e.skipForwardInterval,w.range),this.pollInterval=g(e.pollInterval),this.autoPlay=p(e.autoPlay),this.enableMediaSession=p(e.enableMediaSession)}merging(e){const t={...this};for(const i of Object.keys(e))e[i]!==void 0&&(t[i]=e[i]);return new ae(t)}};class We{constructor(e={}){this.volume=f(e.volume,T.range)??1,this.playbackRate=f(e.playbackRate,U.range)??1,this.preservePitch=p(e.preservePitch)??!0,this.skipBackwardInterval=f(e.skipBackwardInterval,w.range)??10,this.skipForwardInterval=f(e.skipForwardInterval,w.range)??10,this.pollInterval=g(e.pollInterval)??1e3,this.autoPlay=p(e.autoPlay)??!0,this.enableMediaSession=p(e.enableMediaSession)??!0}}class Y{constructor(e,t){this.volume=e.volume??t.volume,this.playbackRate=e.playbackRate??t.playbackRate,this.preservePitch=e.preservePitch??t.preservePitch,this.skipBackwardInterval=e.skipBackwardInterval??t.skipBackwardInterval,this.skipForwardInterval=e.skipForwardInterval??t.skipForwardInterval,this.pollInterval=e.pollInterval??t.pollInterval,this.autoPlay=e.autoPlay??t.autoPlay,this.enableMediaSession=e.enableMediaSession??t.enableMediaSession}}class J{constructor(e,t){this.preferences=new H({...e}),this.settings=t}clear(){this.preferences=new H({volume:null,playbackRate:null,preservePitch:null,skipBackwardInterval:null,skipForwardInterval:null,pollInterval:null,autoPlay:null,enableMediaSession:null})}updatePreference(e,t){this.preferences[e]=t}get volume(){return new y({initialValue:this.preferences.volume,effectiveValue:this.settings.volume,isEffective:this.preferences.volume!==null,onChange:e=>{this.updatePreference("volume",e??null)},supportedRange:T.range,step:T.step})}get playbackRate(){return new y({initialValue:this.preferences.playbackRate,effectiveValue:this.settings.playbackRate,isEffective:this.preferences.playbackRate!==null,onChange:e=>{this.updatePreference("playbackRate",e??null)},supportedRange:U.range,step:U.step})}get preservePitch(){return new S({initialValue:this.preferences.preservePitch,effectiveValue:this.settings.preservePitch,isEffective:this.preferences.preservePitch!==null,onChange:e=>{this.updatePreference("preservePitch",e??null)}})}get skipBackwardInterval(){return new y({initialValue:this.preferences.skipBackwardInterval,effectiveValue:this.settings.skipBackwardInterval,isEffective:this.preferences.skipBackwardInterval!==null,onChange:e=>{this.updatePreference("skipBackwardInterval",e??null)},supportedRange:w.range,step:w.step})}get skipForwardInterval(){return new y({initialValue:this.preferences.skipForwardInterval,effectiveValue:this.settings.skipForwardInterval,isEffective:this.preferences.skipForwardInterval!==null,onChange:e=>{this.updatePreference("skipForwardInterval",e??null)},supportedRange:w.range,step:w.step})}get pollInterval(){return new se({initialValue:this.preferences.pollInterval,effectiveValue:this.settings.pollInterval,isEffective:this.preferences.pollInterval!==null,onChange:e=>{this.updatePreference("pollInterval",e??null)}})}get autoPlay(){return new S({initialValue:this.preferences.autoPlay,effectiveValue:this.settings.autoPlay,isEffective:this.preferences.autoPlay!==null,onChange:e=>{this.updatePreference("autoPlay",e??null)}})}get enableMediaSession(){return new S({initialValue:this.preferences.enableMediaSession,effectiveValue:this.settings.enableMediaSession,isEffective:this.preferences.enableMediaSession!==null,onChange:e=>{this.updatePreference("enableMediaSession",e??null)}})}}class Ve{constructor(e,t,i={}){this.pool=new Map,this._audioEngine=e,this._publication=t,this._supportedAudioTypes=this.detectSupportedAudioTypes(),i.disableRemotePlayback&&(this._audioEngine.getMediaElement().disableRemotePlayback=!0)}detectSupportedAudioTypes(){const e=document.createElement("audio"),t=new Set;for(const s of this._publication.readingOrder.items){s.type&&t.add(s.type);for(const n of s.alternates?.items??[])n.type&&t.add(n.type)}const i=new Map;for(const s of t){const n=e.canPlayType(s);n!==""&&i.set(s,n)}return i}pickPlayableHref(e){const t=this._publication.baseURL,i=[e,...e.alternates?.items??[]];let s;for(const n of i){if(!n.type)continue;const r=this._supportedAudioTypes.get(n.type);if(!r)continue;const l=n.toURL(t)??n.href;if(r==="probably")return l;s||(s={href:l,confidence:r})}return s?.href??e.toURL(t)??e.href}get audioEngine(){return this._audioEngine}ensure(e){let t=this.pool.get(e);return t||(t=document.createElement("audio"),t.preload="auto",this._audioEngine.isWebAudioActive&&(t.crossOrigin="anonymous"),t.src=e,t.load(),this.pool.set(e,t)),t}update(e){const t=this._publication.readingOrder.items,i=new Set;for(let s=0;s<t.length;s++){if(s===e)continue;const n=this.pickPlayableHref(t[s]);s>=e-1&&s<=e+1?(this.ensure(n),i.add(n)):s>=e-1&&s<=e+1&&this.pool.has(n)&&i.add(n)}for(const[s,n]of this.pool)i.has(s)||(n.removeAttribute("src"),n.load(),this.pool.delete(s))}setCurrentAudio(e,t){const i=this.pickPlayableHref(this._publication.readingOrder.items[e]);if(this.audioEngine.changeSrc(i),this.pool.has(i)){const s=this.pool.get(i);s.removeAttribute("src"),s.load(),this.pool.delete(i)}this.update(e)}destroy(){this.audioEngine.stop();for(const[,e]of this.pool)e.removeAttribute("src"),e.load();this.pool.clear()}}let De=class{constructor(e={}){this.dragstartHandler=t=>{t.preventDefault(),t.stopPropagation(),e.onDragDetected?.(Array.from(t.dataTransfer?.types??[]))},this.dragoverHandler=t=>{t.preventDefault(),t.stopPropagation()},this.dropHandler=t=>{t.preventDefault(),t.stopPropagation();const i=Array.from(t.dataTransfer?.types??[]),s=t.dataTransfer?.files.length??0;e.onDropDetected?.(i,s)},this.unloadHandler=()=>this.destroy(),document.addEventListener("dragstart",this.dragstartHandler,!0),document.addEventListener("dragover",this.dragoverHandler,!0),document.addEventListener("drop",this.dropHandler,!0),window.addEventListener("unload",this.unloadHandler)}destroy(){document.removeEventListener("dragstart",this.dragstartHandler,!0),document.removeEventListener("dragover",this.dragoverHandler,!0),document.removeEventListener("drop",this.dropHandler,!0),window.removeEventListener("unload",this.unloadHandler)}};class Be{constructor(e={}){this.copyHandler=t=>{t.preventDefault(),t.stopPropagation(),e.onCopyBlocked?.()},this.unloadHandler=()=>this.destroy(),document.addEventListener("copy",this.copyHandler,!0),window.addEventListener("unload",this.unloadHandler)}destroy(){document.removeEventListener("copy",this.copyHandler,!0),window.removeEventListener("unload",this.unloadHandler)}}class $e extends ne{constructor(e={}){super(e),e.disableDragAndDrop&&(this.dragAndDropProtector=new De({onDragDetected:t=>{this.dispatchSuspiciousActivity("drag_detected",{dataTransferTypes:t,targetFrameSrc:""})},onDropDetected:(t,i)=>{this.dispatchSuspiciousActivity("drop_detected",{dataTransferTypes:t,fileCount:i,targetFrameSrc:""})}})),e.protectCopy&&(this.copyProtector=new Be({onCopyBlocked:()=>{this.dispatchSuspiciousActivity("bulk_copy",{targetFrameSrc:""})}}))}destroy(){super.destroy(),this.dragAndDropProtector?.destroy(),this.copyProtector?.destroy()}}const je=a=>({trackLoaded:a.trackLoaded??(()=>{}),positionChanged:a.positionChanged??(()=>{}),timelineItemChanged:a.timelineItemChanged??(()=>{}),error:a.error??(()=>{}),trackEnded:a.trackEnded??(()=>{}),play:a.play??(()=>{}),pause:a.pause??(()=>{}),metadataLoaded:a.metadataLoaded??(()=>{}),stalled:a.stalled??(()=>{}),seeking:a.seeking??(()=>{}),seekable:a.seekable??(()=>{}),contentProtection:a.contentProtection??(()=>{}),peripheral:a.peripheral??(()=>{}),contextMenu:a.contextMenu??(()=>{}),remotePlaybackStateChanged:a.remotePlaybackStateChanged??(()=>{})});class it extends ke{constructor(e,t,i,s={preferences:{},defaults:{}}){if(super(),this.positionPollInterval=null,this.navigationId=0,this._playIntent=!1,this._preferencesEditor=null,this._mediaSessionEnabled=!1,this._navigatorProtector=null,this._keyboardPeripheralsManager=null,this._suspiciousActivityListener=null,this._keyboardPeripheralListener=null,this._isNavigating=!1,this._isStalled=!1,this._stalledWatchdog=null,this._stalledCheckTime=0,this.pub=e,this.listeners=je(t),this._preferences=new H(s.preferences),this._defaults=new We(s.defaults),this._settings=new Y(this._preferences,this._defaults),e.readingOrder.items.length===0)throw new Error("AudioNavigator: publication has an empty reading order");if(i)this.currentLocation=this.ensureLocatorLocations(i);else{const d=this.pub.readingOrder.items[0];this.currentLocation=new k({href:d.href,type:d.type||"audio/mpeg",title:d.title,locations:new P({position:1,progression:0,totalProgression:0,fragments:["t=0"]})})}const n=this.currentLocation.href.split("#")[0],r=this.hrefToTrackIndex(n);if(r===-1)throw new Error(`AudioNavigator: initial href "${n}" not found in reading order`);const l=R(this.currentLocation.locations)||0,h=new He({playback:{state:{currentTime:l,duration:0},playWhenReady:!1,index:r}});this.pool=new Ve(h,e,s.contentProtection);const o=s.contentProtection||{};this._contentProtection=o;const u=this.mergeKeyboardPeripherals(o,s.keyboardPeripherals||[]);(o.disableContextMenu||o.checkAutomation||o.checkIFrameEmbedding||o.monitorDevTools||o.protectPrinting?.disable||o.disableDragAndDrop||o.protectCopy)&&(this._navigatorProtector=new $e(o),this._suspiciousActivityListener=d=>{const{type:v,...m}=d.detail;v==="context_menu"?this.listeners.contextMenu(m):this.listeners.contentProtection(v,m)},window.addEventListener(A,this._suspiciousActivityListener)),u.length>0&&(this._keyboardPeripheralsManager=new re({keyboardPeripherals:u}),this._keyboardPeripheralListener=d=>{this.listeners.peripheral(d.detail)},window.addEventListener(F,this._keyboardPeripheralListener)),this.setupEventListeners(),this._isNavigating=!0,this.pool.setCurrentAudio(r,"forward"),this.applyPreferences(),this.waitForLoadedAndSeeked(l).then(()=>{this._isNavigating=!1,this.listeners.trackLoaded(this.pool.audioEngine.getMediaElement()),this._notifyTimelineChange(this.currentLocator),this.listeners.positionChanged(this.currentLocator),this._setupRemotePlayback()}).catch(()=>{this._isNavigating=!1})}get settings(){return this._settings}get preferencesEditor(){return this._preferencesEditor===null&&(this._preferencesEditor=new J(this._preferences,this.settings)),this._preferencesEditor}async submitPreferences(e){this._preferences=this._preferences.merging(e),this.applyPreferences()}applyPreferences(){this._settings=new Y(this._preferences,this._defaults),this._preferencesEditor!==null&&(this._preferencesEditor=new J(this._preferences,this.settings)),this.pool.audioEngine.setVolume(this._settings.volume),this.pool.audioEngine.setPlaybackRate(this._settings.playbackRate,this._settings.preservePitch),this.positionPollInterval!==null&&this.startPositionPolling(),this._settings.enableMediaSession&&!this._mediaSessionEnabled?(this._mediaSessionEnabled=!0,this.setupMediaSession()):!this._settings.enableMediaSession&&this._mediaSessionEnabled&&(this._mediaSessionEnabled=!1,this.destroyMediaSession())}get publication(){return this.pub}get timeline(){return this.pub.timeline}_notifyTimelineChange(e){const t=this.pub.timeline.locate(e);t!==this._currentTimelineItem&&(this._currentTimelineItem=t,this.listeners.timelineItemChanged(t),this._settings.enableMediaSession&&this.updateMediaSessionMetadata())}ensureLocatorLocations(e){return new k({...e,locations:e.locations instanceof P?e.locations:e.locations?new P(e.locations):void 0})}hrefToTrackIndex(e){const t=e.split("#")[0];return this.pub.readingOrder.items.findIndex(i=>i.href===t)}currentTrackIndex(){return this.hrefToTrackIndex(this.currentLocation.href)}get currentLocator(){return this.currentLocation}get isPlaying(){return this.pool.audioEngine.isPlaying()}get isPaused(){return this.pool.audioEngine.isPaused()}get duration(){return this.pool.audioEngine.duration()}get currentTime(){return this.pool.audioEngine.currentTime()}createLocator(e,t){const i=this.pub.readingOrder.items[e];if(!i)throw new Error(`Invalid track index: ${e}`);const s=this.pool.audioEngine.duration();return new k({href:i.href,type:i.type||"audio/mpeg",title:i.title,locations:new P({progression:s>0?t/s:0,position:e+1,fragments:[`t=${t}`]})})}waitForLoadedAndSeeked(e,t){return new Promise((i,s)=>{const n=()=>{if(t!==void 0&&t!==this.navigationId){i();return}if(e<=0){i();return}const h=()=>{this.pool.audioEngine.off("seeked",h),i()};this.pool.audioEngine.on("seeked",h),this.seek(e)};if(this.pool.audioEngine.isLoaded()){n();return}const r=()=>{this.pool.audioEngine.off("canplaythrough",r),this.pool.audioEngine.off("error",l),n()},l=h=>{this.pool.audioEngine.off("canplaythrough",r),this.pool.audioEngine.off("error",l),s(h)};this.pool.audioEngine.on("canplaythrough",r),this.pool.audioEngine.on("error",l)})}setupEventListeners(){this.pool.audioEngine.on("error",e=>{this.listeners.error(e,this.currentLocator)}),this.pool.audioEngine.on("ended",async()=>{this.stopPositionPolling(),this.currentLocation=this.currentLocation.copyWithLocations(new P({position:this.currentTrackIndex()+1,progression:1,fragments:[`t=${this.duration}`]})),this.listeners.trackEnded(this.currentLocator),this.canGoForward&&(await this.nextTrack(),this._settings.autoPlay&&this.play())}),this.pool.audioEngine.on("play",()=>{this._isNavigating||(this.startPositionPolling(),this.listeners.play(this.currentLocator))}),this.pool.audioEngine.on("playing",()=>{this._isNavigating||this._setStalled(!1)}),this.pool.audioEngine.on("pause",()=>{this._isNavigating||(this.stopPositionPolling(),this.listeners.pause(this.currentLocator))}),this.pool.audioEngine.on("seeked",()=>{if(this._isNavigating)return;this.listeners.seeking(!1);const e=this.currentTime,t=this.duration,i=t>0?e/t:0;this.currentLocation=this.currentLocation.copyWithLocations(new P({position:this.currentTrackIndex()+1,progression:i,fragments:[`t=${e}`]})),this._notifyTimelineChange(this.currentLocation),this.listeners.positionChanged(this.currentLocation)}),this.pool.audioEngine.on("seeking",()=>{this._isNavigating||this.listeners.seeking(!0)}),this.pool.audioEngine.on("waiting",()=>{this._isNavigating||this.listeners.seeking(!0)}),this.pool.audioEngine.on("stalled",()=>{this._isNavigating||this._setStalled(!0)}),this.pool.audioEngine.on("canplaythrough",()=>{this._isNavigating||this._setStalled(!1)}),this.pool.audioEngine.on("progress",e=>{this._isNavigating||this.listeners.seekable(e)}),this.pool.audioEngine.on("loadedmetadata",()=>{const e=this.pool.audioEngine.getMediaElement(),t={duration:this.pool.audioEngine.duration(),textTracks:e.textTracks,readyState:e.readyState,networkState:e.networkState};this.listeners.metadataLoaded(t)})}_setStalled(e){this._isStalled!==e&&(this._isStalled=e,this.listeners.stalled(e),e?(this._stalledCheckTime=this.currentTime,this._startStalledWatchdog()):this._stopStalledWatchdog())}_startStalledWatchdog(){this._stalledWatchdog=setInterval(()=>{if(!this.isPlaying){this._setStalled(!1);return}const e=this.currentTime;e!==this._stalledCheckTime&&this._setStalled(!1),this._stalledCheckTime=e},500)}_stopStalledWatchdog(){this._stalledWatchdog!==null&&(clearInterval(this._stalledWatchdog),this._stalledWatchdog=null)}setupMediaSession(){"mediaSession"in navigator&&(navigator.mediaSession.setActionHandler("play",()=>this.play()),navigator.mediaSession.setActionHandler("pause",()=>this.pause()),navigator.mediaSession.setActionHandler("previoustrack",()=>this.goBackward(!1,()=>{})),navigator.mediaSession.setActionHandler("nexttrack",()=>this.goForward(!1,()=>{})),navigator.mediaSession.setActionHandler("seekbackward",e=>this.jump(-(e.seekOffset||10))),navigator.mediaSession.setActionHandler("seekforward",e=>this.jump(e.seekOffset||10)),this.updateMediaSessionMetadata())}updateMediaSessionMetadata(){if(!("mediaSession"in navigator))return;const e=this.currentTrackIndex(),t=this.pub.readingOrder.items[e],i=this.pub.getCover();navigator.mediaSession.metadata=new MediaMetadata({title:t?.title||`Track ${e+1}`,artist:this.pub.metadata.authors?this.pub.metadata.authors.items.map(s=>s.name.getTranslation()).join(", "):void 0,album:this.pub.metadata.title.getTranslation(),artwork:i?[{src:i.toURL(this.pub.baseURL)??i.href,type:i.type}]:void 0})}startPositionPolling(){this.stopPositionPolling(),this.positionPollInterval=setInterval(()=>{const e=this.currentTime,t=this.duration,i=t>0?e/t:0;this.currentLocation=this.currentLocation.copyWithLocations(new P({position:this.currentTrackIndex()+1,progression:i,fragments:[`t=${e}`]})),this._notifyTimelineChange(this.currentLocation),this.listeners.positionChanged(this.currentLocation)},this._settings.pollInterval)}stopPositionPolling(){this.positionPollInterval!==null&&(clearInterval(this.positionPollInterval),this.positionPollInterval=null)}async go(e,t,i){try{e=this.ensureLocatorLocations(e);const s=e.href.split("#")[0],n=this.hrefToTrackIndex(s),r=R(e.locations)||0;if(n===-1){i(!1);return}const l=++this.navigationId,h=this.currentTrackIndex(),o=n>=h?"forward":"backward",u=this.isPlaying||this._playIntent;if(this._playIntent=u,this._isNavigating=!0,this.stopPositionPolling(),this.pool.setCurrentAudio(n,o),this.currentLocation=e.copyWithLocations(e.locations),await this.waitForLoadedAndSeeked(r,l),this._isNavigating=!1,l!==this.navigationId){i(!1);return}n!==h&&this.listeners.trackLoaded(this.pool.audioEngine.getMediaElement()),this._notifyTimelineChange(this.currentLocator),this.listeners.positionChanged(this.currentLocator),this._settings.enableMediaSession&&this.updateMediaSessionMetadata(),u&&this.play(),i(!0)}catch(s){this._isNavigating=!1,console.error("Failed to go to locator:",s),i(!1)}finally{this._playIntent=!1}}async goLink(e,t,i){const s=this.hrefToTrackIndex(e.href);if(s===-1){i(!1);return}const n=R(e.locator.locations)??0,r=this.createLocator(s,n);await this.go(r,t,i)}async goForward(e,t){if(!this.canGoForward){t(!1);return}await this.nextTrack(),t(!0)}async goBackward(e,t){if(!this.canGoBackward){t(!1);return}await this.previousTrack(),t(!0)}play(){this.pool.audioEngine.play()}pause(){this.pool.audioEngine.pause()}stop(){this.pool.audioEngine.stop()}async nextTrack(){if(!this.canGoForward)return;const e=this.createLocator(this.currentTrackIndex()+1,0);await this.go(e,!1,()=>{})}async previousTrack(){if(!this.canGoBackward)return;const e=this.createLocator(this.currentTrackIndex()-1,0);await this.go(e,!1,()=>{})}seek(e){this.pool.audioEngine.skip(e-this.pool.audioEngine.currentTime())}jump(e){this.pool.audioEngine.skip(e)}skipForward(){this.pool.audioEngine.skip(this._settings.skipForwardInterval)}skipBackward(){this.pool.audioEngine.skip(-this._settings.skipBackwardInterval)}get isTrackStart(){return this.currentTrackIndex()===0&&(R(this.currentLocation.locations)||0)===0}get isTrackEnd(){const e=this.currentTrackIndex();if(e!==this.pub.readingOrder.items.length-1)return!1;const t=this.currentLocation.locations?.progression;if(t!==void 0)return t>=1;const i=this.pub.readingOrder.items[e],s=this.duration||i?.duration||0;return s>0&&(R(this.currentLocation.locations)??0)>=s}get canGoBackward(){return this.currentTrackIndex()>0}get canGoForward(){return this.currentTrackIndex()<this.pub.readingOrder.items.length-1}get remotePlayback(){const e=this.pool.audioEngine.getMediaElement();return"remote"in e?e.remote:void 0}_setupRemotePlayback(){if(this._contentProtection.disableRemotePlayback)return;const e=this.remotePlayback;e&&(e.onconnecting=()=>this.listeners.remotePlaybackStateChanged("connecting"),e.onconnect=()=>this.listeners.remotePlaybackStateChanged("connected"),e.ondisconnect=()=>this.listeners.remotePlaybackStateChanged("disconnected"))}destroyMediaSession(){"mediaSession"in navigator&&(navigator.mediaSession.metadata=null,navigator.mediaSession.setActionHandler("play",null),navigator.mediaSession.setActionHandler("pause",null),navigator.mediaSession.setActionHandler("previoustrack",null),navigator.mediaSession.setActionHandler("nexttrack",null),navigator.mediaSession.setActionHandler("seekbackward",null),navigator.mediaSession.setActionHandler("seekforward",null))}destroy(){this.stopPositionPolling(),this._stopStalledWatchdog(),this.destroyMediaSession(),this._suspiciousActivityListener&&window.removeEventListener(A,this._suspiciousActivityListener),this._keyboardPeripheralListener&&window.removeEventListener(F,this._keyboardPeripheralListener),this._navigatorProtector?.destroy(),this._keyboardPeripheralsManager?.destroy(),this.pool.destroy()}}export{We as AudioDefaults,it as AudioNavigator,H as AudioPreferences,J as AudioPreferencesEditor,Y as AudioSettings,rt as BUILTIN_DECORATION_TYPES,S as BooleanPreference,ot as DecorationLayout,at as DecorationStyleType,lt as DecorationWidth,ue as EnumPreference,ht as EpubDefaults,ct as EpubNavigator,Ze as EpubPreferences,dt as EpubPreferencesEditor,ut as EpubSettings,et as ExperimentalWebPubNavigator,pt as FXLCoordinator,mt as FXLFrameManager,gt as FXLFramePoolManager,ft as FXLPeripherals,yt as FXLSpreader,D as FrameComms,vt as FrameManager,bt as FramePoolManager,St as HorizontalThird,ye as Injector,_t as LineLengths,ke as MediaNavigator,Pt as Navigator,wt as Orientation,se as Preference,Q as Properties,Et as RSProperties,y as RangePreference,kt as ReadiumCSS,Lt as Spread,I as TextAlignment,Rt as UserProperties,Ot as VerticalThird,fe as VisualNavigator,He as WebAudioEngine,Le as WebPubBlobBuilder,Ce as WebPubCSS,Ie as WebPubDefaults,Re as WebPubFrameManager,Oe as WebPubFramePoolManager,Me as WebPubNavigator,L as WebPubPreferences,X as WebPubPreferencesEditor,G as WebPubSettings,xe as WebRSProperties,oe as WebUserProperties,_e as decorationsEqual,p as ensureBoolean,te as ensureEnumValue,de as ensureExperiment,xt as ensureFilter,Ct as ensureLessThanOrEqual,It as ensureMoreThanOrEqual,g as ensureNonNegative,ee as ensureString,f as ensureValueInRange,ce as experiments,At as filterRangeConfig,Ft as fontSizeRangeConfig,x as fontWeightRangeConfig,Tt as fontWidthRangeConfig,be as getScriptMode,Ut as i18n,B as letterSpacingRangeConfig,$ as lineHeightRangeConfig,zt as lineLengthRangeConfig,j as paragraphIndentRangeConfig,q as paragraphSpacingRangeConfig,U as playbackRateRangeConfig,N as resolveDecorationForWire,Mt as settings,w as skipIntervalRangeConfig,Se as supportsDecorationStyle,T as volumeRangeConfig,Nt as withFallback,Z as wordSpacingRangeConfig,C as zoomRangeConfig};
