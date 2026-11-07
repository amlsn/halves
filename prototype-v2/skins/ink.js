/* Halves V2 · skin "ink" behaviour — 1930s rubber-hose genre (DESIGN.md §9.6, §9.8 "Ink skin").
   Loaded (defer) on every skin; does nothing unless html[data-skin="ink"], and tears its art down when switched away.
   What it does while active:
   - injects Google Fonts (Archivo UI + Bebas Neue numbers + Limelight title-card display), once. V2r1: Grandstander dropped (§9.1a)
   - adds its own filter defs (#inkw-ui, #inkw-sm wobble; #ink-smear(-x) directional blur) + a grain tile
   - pre-draws 3 rough hand-inked frames (light + dark ink) → CSS vars --ink-l0..2/--ink-d0..2 used as border-images
   - line boil: swaps frame 0/1/2 (--ink-fr / --ink-frs, data-ink-ui / data-ink-sm) and cycles the wobble seeds
       stop   → (experimental) UI frames at ~6fps, .sm at ~12fps (Motion.onFrame); lists/sheets/kv never boil (CSS)
       hybrid → .sm at ~12fps, UI slow-boils (~1.4fps, only when idle)
       fluid  → slow, subtle boil only when idle
       reduced motion / hidden tab → nothing
   - draws mascot "Penny" (original coin / piggy-bank) into .mascot, ornaments into .ornament[data-slot], inked rings on
     the FAB and dial, and a gloved pointer on the dial; moods are pure CSS on .mascot[data-mood]
   - stop motion: 4-frame held-pose spring (--ink-hold; first frame clamped ≤ rest). V2r1: no smear on the sheet or page
     (large-area blur read as a glitch and cost paint); sheets settle via the shared no-overshoot --spring-sheet */
(()=>{
  const R=document.documentElement, SVGNS='http://www.w3.org/2000/svg';
  const on=()=>R.dataset.skin==='ink';
  const RMq=matchMedia('(prefers-reduced-motion:reduce)'), rm=()=>RMq.matches;
  const motion=()=>R.dataset.motion||'fluid';
  const M=typeof Motion!=='undefined'?Motion:null;
  let live=false, slowT=null, lastAct=0, slow=0, defs=null, tickN=0;

  /* ---------- deterministic rng ---------- */
  const rng=seed=>{let s=(seed>>>0)||1;return()=>(s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296};
  const f1=n=>Math.round(n*10)/10;

  /* ---------- fonts ---------- */
  function fonts(){
    if(document.getElementById('ink-fonts'))return;
    const l=document.createElement('link');l.id='ink-fonts';l.rel='stylesheet';
    l.href='https://fonts.googleapis.com/css2?family=Archivo:wght@400..700&family=Bebas+Neue&family=Limelight&display=swap';
    document.head.appendChild(l);
  }

  /* ---------- filter defs (own ids, so the shared #ink-wobble/#grain placeholders stay untouched for other skins) ---------- */
  function addDefs(){
    if(document.getElementById('ink-defs'))return;
    const d=document.createElement('div');
    d.innerHTML=`<svg id="ink-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
      <filter id="inkw-ui" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="1"/><feDisplacementMap in="SourceGraphic" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>
      <filter id="inkw-sm" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="11"/><feDisplacementMap in="SourceGraphic" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>
      <filter id="ink-smear" x="-5%" y="-25%" width="110%" height="150%"><feGaussianBlur stdDeviation="0 9"/></filter>
      <filter id="ink-smear-x" x="-25%" y="-5%" width="150%" height="110%"><feGaussianBlur stdDeviation="10 0"/></filter>
    </defs></svg>`;
    defs=d.firstElementChild;document.body.prepend(defs);
  }
  const turb=id=>document.querySelector(`#${id} feTurbulence`), disp=id=>document.querySelector(`#${id} feDisplacementMap`);
  function wobbleScale(){ // stronger, faster boil in stop / .sm; barely-there in fluid
    const m=motion(), sm=m==='fluid'||rm()?1.4:2.6, ui=m==='stop'&&!rm()?2.2:1.4;
    disp('inkw-sm')?.setAttribute('scale',sm);disp('inkw-ui')?.setAttribute('scale',ui);
  }

  /* ---------- 3 pre-drawn rough frames → border-image data URIs ----------
     120×120 image, slice 36 (corners drawn once), middle 48 repeats (round). Edge wobble + width are periodic over the
     repeating tile so tiles join cleanly. Width is uneven (thicker bottom/right, ink pooling); corners have their own
     radii and two corners get a pen overshoot. Variants share the structure and differ only in jitter → boil. */
  function framePath(v){
    const S=120,B=6,T=36,P=48, rs=rng(7), rv=rng(101+v*37);
    const cr=[22+rs()*6,20+rs()*7,23+rs()*5,21+rs()*6]; // tl,tr,br,bl
    const E=[3.4,4.4,6,4.8].map(w=>({w:w+rs()*.6,a1:.25+rv()*.35,p1:rv()*6.283,a2:.25+rv()*.3,p2:rv()*6.283,b:.7+rs()*.5,p3:rs()*6.283}));
    const off=(e,s)=>{const q=E[e],u=(s-T)/P*6.283;return q.a1*Math.sin(u+q.p1)+q.a2*Math.sin(2*u+q.p2)};
    const wid=(e,s)=>{const q=E[e],u=(s-T)/P*6.283;return q.w+q.b*Math.sin(u+q.p3)};
    const pts=[]; // [x,y,nx,ny,off,w]
    const line=(e,fixed,a,b,horiz,n)=>{const st=a<b?2:-2;for(let s=a;st>0?s<b:s>b;s+=st){pts.push(horiz?[s,fixed,0,n,off(e,s),wid(e,s)]:[fixed,s,n,0,off(e,s),wid(e,s)])}};
    const arc=(cx,cy,r,a0,a1,eA,sA,eB,sB)=>{const N=9;for(let i=0;i<=N;i++){const t=i/N,a=(a0+(a1-a0)*t)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
      pts.push([cx+r*c,cy+r*s,c,s,off(eA,sA)*(1-t)+off(eB,sB)*t,wid(eA,sA)*(1-t)+wid(eB,sB)*t])}};
    line(0,B,B+cr[0],S-B-cr[1],true,-1);
    arc(S-B-cr[1],B+cr[1],cr[1],-90,0,0,S-B-cr[1],1,B+cr[1]);
    line(1,S-B,B+cr[1],S-B-cr[2],false,1);
    arc(S-B-cr[2],S-B-cr[2],cr[2],0,90,1,S-B-cr[2],2,S-B-cr[2]);
    line(2,S-B,S-B-cr[2],B+cr[3],true,1);
    arc(B+cr[3],S-B-cr[3],cr[3],90,180,2,B+cr[3],3,S-B-cr[3]);
    line(3,B,S-B-cr[3],B+cr[0],false,-1);
    arc(B+cr[0],B+cr[0],cr[0],180,270,3,B+cr[0],0,B+cr[0]);
    const o=pts.map(p=>[p[0]+p[2]*(p[4]+p[5]/2),p[1]+p[3]*(p[4]+p[5]/2)]),i=pts.map(p=>[p[0]+p[2]*(p[4]-p[5]/2),p[1]+p[3]*(p[4]-p[5]/2)]).reverse();
    const poly=a=>'M'+a.map(p=>f1(p[0])+' '+f1(p[1])).join('L')+'Z';
    // pen overshoots: a tapered flick past the top-left and bottom-right corners
    const tl=[B+cr[0]+2,B+off(0,B+cr[0])], br=[S-B-cr[2]-2,S-B+off(2,S-B-cr[2])];
    const flick=(x,y,dx,dy,w)=>`M${f1(x)} ${f1(y-w/2)}L${f1(x+dx)} ${f1(y+dy-.3)}L${f1(x+dx)} ${f1(y+dy+.3)}L${f1(x)} ${f1(y+w/2)}Z`;
    return poly(o)+poly(i)+flick(tl[0],tl[1]-.6,-(cr[0]-2)+(v-1)*.8,-1.4,E[0].w)+flick(br[0],br[1]+.6,cr[2]-6+(v-1)*.8,1.2,E[2].w*.9);
  }
  function frames(){
    const set=(k,v)=>R.style.setProperty(k,v);
    [0,1,2].forEach(v=>{const d=framePath(v);
      [['l','#1E1612'],['d','#F1E4C8']].forEach(([t,c])=>{
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><path fill="${c}" fill-rule="nonzero" d="${d}"/></svg>`;
        set(`--ink-${t}${v}`,`url("data:image/svg+xml,${encodeURIComponent(svg)}")`)})});
    // film grain tile (static image; the CSS only translates it → compositor-only flicker)
    const g=`<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n" x="0" y="0"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch" seed="4"/><feColorMatrix values="0 0 0 0 .12  0 0 0 0 .08  0 0 0 0 .05  2.2 0 0 0 -1.05"/></filter><rect width="220" height="220" filter="url(#n)"/></svg>`;
    set('--ink-grain',`url("data:image/svg+xml,${encodeURIComponent(g)}")`);
  }

  /* round outline for FAB / dial (3 variants, shown by data-ink-ui) */
  function ringPaths(w0){
    let s='';for(let v=0;v<3;v++){const r=rng(300+v*17),a=[r()*6.28,r()*6.28,r()*6.28],o=[],n=[],N=56;
      for(let k=0;k<=N;k++){const t=k/N*6.283,j=.9*Math.sin(3*t+a[0])+.5*Math.sin(5*t+a[1]),w=w0*(1+.35*Math.sin(t-.8+a[2]*.1)+.25*Math.sin(t+.8));
        const rr=47.5+j*.6;o.push([50+(rr)*Math.cos(t),50+(rr)*Math.sin(t)]);n.push([50+(rr-w)*Math.cos(t),50+(rr-w)*Math.sin(t)])}
      const poly=a=>'M'+a.map(p=>f1(p[0])+' '+f1(p[1])).join('L')+'Z';
      s+=`<path class="v${v}" fill-rule="evenodd" d="${poly(o)}${poly(n.reverse())}"/>`}
    return s;
  }
  const RING={};
  const ringSVG=w=>`<svg class="ink-ring ink-x" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">${RING[w]||(RING[w]=ringPaths(w))}</svg>`;

  /* ---------- 4-frame held-pose spring for stop motion (same spring as the runtime, held per frame) ---------- */
  function hold(){
    const b=rm()?0:(typeof prefs!=='undefined'?+prefs.bounce:1)||0, z=b>.01?.9*Math.exp(-.81*b):.97;
    const w=5/z,wd=w*Math.sqrt(1-z*z),x=t=>1-Math.exp(-z*w*t)*(Math.cos(wd*t)+z*w/wd*Math.sin(wd*t)),F=4,a=[];
    for(let k=0;k<F;k++){const v=k===F-1?1:k===0?Math.min(1,x(1/F)):x((k+1)/F);a.push(`${v.toFixed(3)} ${(k/F*100).toFixed(1)}%`,`${v.toFixed(3)} ${((k+1)/F*100).toFixed(1)}%`)}
    R.style.setProperty('--ink-hold',`linear(${a.join(',')})`);
  }

  /* ---------- art ---------- */
  const star=(cx,cy,s,cls='pn-star')=>{const k=s*.2;return `<path class="${cls}" d="M${cx} ${cy-s}Q${f1(cx+k)} ${f1(cy-k)} ${cx+s} ${cy}Q${f1(cx+k)} ${f1(cy+k)} ${cx} ${cy+s}Q${f1(cx-k)} ${f1(cy+k)} ${cx-s} ${cy}Q${f1(cx-k)} ${f1(cy-k)} ${cx} ${cy-s}Z"/>`};
  const pie=(cx,cy,rx,ry,a1=-74,a2=-24)=>{const P=a=>[f1(cx+rx*Math.cos(a*Math.PI/180)),f1(cy+ry*Math.sin(a*Math.PI/180))];const[x2,y2]=P(a2),[x1,y1]=P(a1);
    return `<path class="pn-dk" d="M${cx} ${cy}L${x2} ${y2}A${rx} ${ry} 0 1 1 ${x1} ${y1}Z"/>`};
  const GLOVE=`<path class="pn-glove" d="M-5 1Q-8.5 4-7.8 8Q-9 12-5.2 13.6Q-3 16.4 0 14.6Q3 16.6 5.6 13.6Q9 12 7.8 8Q10 5.5 7.6 3.2Q7.8.5 5 1Z"/><path class="pn-fl" d="M-2.2 10.5Q-2.6 12.6-1.6 14.2M2.4 10.5Q2.8 12.6 2.2 14.2"/><path class="pn-glove" d="M-6.5-3H6.5Q7.6-3 7.6-1.6V.6Q7.6 2 6.2 2H-6.2Q-7.6 2-7.6.6V-1.6Q-7.6-3-6.5-3Z"/>`;
  const ARM=side=>`<g class="pn-arm pn-arm-${side}"><path class="pn-hose" d="M31 64C23 68 18 75 18 81"/><g transform="translate(18 84)">${GLOVE}</g></g>`;
  /* Penny: an original coin-bodied piggy bank. Coin slot on top, piggy ears + snout, pie-cut eyes, rubber-hose limbs, white gloves. */
  const PENNY=f=>`<svg class="penny ink-art ink-x" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><g filter="url(#${f})">
    <ellipse class="pn-shadow" cx="60" cy="113" rx="24" ry="3.6"/>
    <g class="pn-jump"><g class="pn-squash">
      <g class="pn-smear"><path class="pn-line" d="M44 96v13M60 99v14M76 96v13"/></g>
      <path class="pn-hose" d="M52 88C52 95 48 98 47 103M68 88C68 95 72 98 73 103"/>
      <path class="pn-shoe" d="M34 109Q33 101 44 101.5Q52 102 52.5 108Q52.5 110.5 49 110.5H37Q34 110.5 34 109Z"/>
      <path class="pn-shoe" d="M86 109Q87 101 76 101.5Q68 102 67.5 108Q67.5 110.5 71 110.5H83Q86 110.5 86 109Z"/>
      <ellipse class="pn-shine" cx="41" cy="104.4" rx="3" ry="1.3"/><ellipse class="pn-shine" cx="79" cy="104.4" rx="3" ry="1.3"/>
      <path class="pn-coin" d="M38 40L33 19Q35 17 38 18L52 29ZM82 40L87 19Q85 17 82 18L68 29Z"/>
      <path class="pn-pink" d="M38.5 33L36.5 23.5L45 29ZM81.5 33L83.5 23.5L75 29Z"/>
      <circle class="pn-coin" cx="60" cy="58" r="32"/>
      <circle class="pn-rim" cx="60" cy="58" r="26.5"/>
      <rect class="pn-dk" x="51" y="28.5" width="18" height="4.2" rx="2.1"/>
      <g class="pn-eyes"><ellipse class="pn-eye" cx="51" cy="51" rx="4.2" ry="5.4"/><ellipse class="pn-eye" cx="69" cy="51" rx="4.2" ry="5.4"/>${pie(52,53,2.3,3.3)}${pie(70,53,2.3,3.3)}
        <path class="pn-lid" d="M46.6 51.6Q46.6 45.4 51 45.4Q55.4 45.4 55.4 51.6Q51 50.2 46.6 51.6Z"/><path class="pn-lid" d="M64.6 51.6Q64.6 45.4 69 45.4Q73.4 45.4 73.4 51.6Q69 50.2 64.6 51.6Z"/></g>
      <path class="pn-dl pn-shut" d="M45 52Q51 57.5 57 52M63 52Q69 57.5 75 52"/>
      <path class="pn-dl pn-brows" d="M45 42L56 38.6M75 42L64 38.6"/>
      <path class="pn-dl pn-brow1" d="M64.4 40.6Q69 36.4 74.6 39"/>
      <ellipse class="pn-cheek" cx="41.5" cy="66" rx="4.6" ry="2.8"/><ellipse class="pn-cheek" cx="78.5" cy="66" rx="4.6" ry="2.8"/>
      <ellipse class="pn-snout" cx="60" cy="66.5" rx="8.6" ry="5.8"/>
      <ellipse class="pn-dk" cx="57" cy="66.5" rx="1.3" ry="2.2"/><ellipse class="pn-dk" cx="63" cy="66.5" rx="1.3" ry="2.2"/>
      <path class="pn-dl pn-m pn-m-smile" d="M53 77Q60 78.2 67.5 75.2"/>
      <g class="pn-m pn-m-grin"><path class="pn-dk" d="M50 74Q60 72.5 70 74Q68 85 60 85Q52 85 50 74Z"/><path class="pn-pink" d="M54 81.4Q60 78.4 66 81.4Q63 84.5 60 84.5Q57 84.5 54 81.4Z"/></g>
      <path class="pn-dl pn-m pn-m-wavy" d="M51 78Q53.3 75.5 55.5 78T60 78T64.5 78T69 78"/>
      <ellipse class="pn-dk pn-m pn-m-o" cx="60" cy="78" rx="2.6" ry="2.3"/>
      ${ARM('l')}<g transform="matrix(-1 0 0 1 120 0)">${ARM('r')}</g>
    </g></g>
    <path class="pn-drop" d="M95 32Q90 40 92.5 43Q95 45.5 97.5 43Q100 40 95 32Z"/>
    <g class="pn-z"><path class="pn-line" d="M86 22h7l-7 8h7M97 10h5l-5 6h5" style="stroke-width:2"/></g>
    <g class="pn-stars">${star(104,26,5)}</g>
  </g></svg>`;
  /* ornaments: genre motifs only (twinkles, pen swash, spotlight burst, sleepy moon) */
  const ORN={
    hero:f=>`<svg class="ink-orn ink-art ink-x" viewBox="0 0 110 92" aria-hidden="true" focusable="false"><g filter="url(#${f})">
      <g class="tw">${star(12,16,6.5,'acc')}</g><g class="tw">${star(102,84,5,'acc')}</g><g class="tw">${star(18,50,3.5,'acc')}</g>
      <path class="ln" d="M24 30l-7-3M23 37l-8 0M25 44l-6 3"/></g></svg>`,
    folder:f=>`<svg class="ink-orn ink-art ink-x" viewBox="0 0 150 18" preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false"><g filter="url(#${f})">
      <path class="ln" d="M3 10C24 4 48 15 76 8S118 4 132 9q6 2 4 5q-3 2-5-1"/><path class="acc" d="M142 5l3 4-3 4-3-4z"/></g></svg>`,
    empty:f=>{let r='';for(let i=0;i<16;i++){const a=i/16*6.283,a2=a+.11,l=i%2?62:72;
        r+=`<path d="M${f1(46*Math.cos(a-.05))} ${f1(46*Math.sin(a-.05))}L${f1(l*Math.cos(a))} ${f1(l*Math.sin(a))}L${f1(46*Math.cos(a2))} ${f1(46*Math.sin(a2))}Z"/>`}
      return `<svg class="ink-orn ink-art ink-x" viewBox="-75 -75 150 150" aria-hidden="true" focusable="false"><g filter="url(#${f})"><g class="spin ray">${r}</g>
        <g class="tw">${star(-58,-50,6,'acc')}</g><g class="tw">${star(60,40,5,'acc')}</g></g></svg>`},
    nudge:f=>`<svg class="ink-orn ink-art ink-x" viewBox="0 0 160 70" aria-hidden="true" focusable="false"><g filter="url(#${f})">
      <path class="pap" d="M86 8A26 26 0 1 0 104 50A20 20 0 1 1 86 8Z"/><path class="ln" d="M84 30q3 3 6 0" style="stroke-width:1.8"/>
      <g class="tw">${star(36,22,5,'acc')}</g><g class="tw">${star(128,16,4,'acc')}</g><g class="tw">${star(140,50,3,'acc')}</g></g></svg>`,
  };
  ORN.today=ORN.hero;
  /* dial pointer: a white glove pointing outward */
  const GLOVE_PTR=`<svg class="ink-glove ink-x" viewBox="0 0 30 36" aria-hidden="true" focusable="false"><g filter="url(#inkw-ui)" class="penny">
    <path class="pn-glove" d="M11.5 17V7Q11.5 3 15 3Q18.5 3 18.5 7V14Q21 12.5 22.5 14.5Q25 15 24.5 18.5Q25.5 22 23 25Q21.5 29 17 29H12Q7.5 29 6.5 24.5Q5 21 7 19Q8 15.5 11.5 17Z"/>
    <path class="pn-fl" d="M18.5 14Q19.6 17 18.6 19.5M22.5 15Q23.2 18 21.6 20.5M7 19Q10 20 11.5 22.5"/>
    <path class="pn-glove" d="M10 29H20Q21 29 21 30.5V33Q21 34.5 19.5 34.5H10.5Q9 34.5 9 33V30.5Q9 29 10 29Z"/><path class="pn-fl" d="M9.5 31.8H20.5"/></g></svg>`;

  /* ---------- decorate / teardown ---------- */
  const filt=el=>el.closest('.sm')?'inkw-sm':'inkw-ui';
  function decorate(){
    if(!on())return;
    document.querySelectorAll('.mascot').forEach(m=>{if(!m.querySelector(':scope>.penny')){m.innerHTML=PENNY('inkw-sm');boil(m.firstElementChild)}});
    document.querySelectorAll('.ornament[data-slot]').forEach(o=>{const fn=ORN[o.dataset.slot];if(fn&&!o.querySelector(':scope>.ink-orn')){o.innerHTML=fn(filt(o));boil(o.firstElementChild)}});
    document.querySelectorAll('.fab').forEach(b=>{if(!b.querySelector(':scope>.ink-ring'))b.insertAdjacentHTML('beforeend',ringSVG(6))});
    const ring=document.getElementById('dialRing'),core=document.getElementById('dialCore'),ticks=document.getElementById('dialTicks');
    if(ring&&!ring.querySelector(':scope>.ink-ring'))ring.insertAdjacentHTML('beforeend',ringSVG(3.6));
    if(core&&!core.querySelector(':scope>.ink-ring'))core.insertAdjacentHTML('beforeend',ringSVG(7));
    if(ticks&&!ticks.querySelector(':scope>.ink-glove'))ticks.insertAdjacentHTML('beforeend',GLOVE_PTR);
  }
  function boil(el){if(el&&M&&!rm()){M.boil(el);el.classList.add('ink-boiled')}}
  function teardown(){
    document.querySelectorAll('.mascot>.penny,.ornament>.ink-orn').forEach(n=>n.parentNode.replaceChildren());
    document.querySelectorAll('.ink-x').forEach(n=>n.remove());
    document.querySelectorAll('.ink-smear,.ink-smear-x').forEach(n=>n.classList.remove('ink-smear','ink-smear-x'));
    ['--ink-fr','--ink-frs','--ink-hold','--ink-grain','--ink-l0','--ink-l1','--ink-l2','--ink-d0','--ink-d1','--ink-d2'].forEach(k=>R.style.removeProperty(k));
    delete R.dataset.inkUi;delete R.dataset.inkSm;
  }

  /* ---------- boil clock ---------- */
  const setUi=f=>{R.style.setProperty('--ink-fr',`var(--ink-f${f})`);R.dataset.inkUi=f;turb('inkw-ui')?.setAttribute('seed',f+1)};
  const setSm=f=>{R.style.setProperty('--ink-frs',`var(--ink-f${f})`);R.dataset.inkSm=f;turb('inkw-sm')?.setAttribute('seed',f+11)};
  function onFrame(f){ // ~12fps from the runtime (only runs in stop/hybrid, never under reduced motion)
    if(!live||rm()||document.hidden)return;
    const m=motion();tickN++;if(m==='stop'){if(tickN%2===0)setUi((tickN/2)%3);setSm(f)}else if(m==='hybrid')setSm(f);
  }
  function slowTick(){ // subtle idle boil for fluid UI (and hybrid UI)
    if(!live||rm()||document.hidden||motion()==='stop'||Date.now()-lastAct<1500)return;
    slow=(slow+1)%3;setUi(slow);if(motion()==='fluid')setSm(slow);
  }
  ['pointerdown','keydown','wheel','touchmove'].forEach(t=>addEventListener(t,()=>{lastAct=Date.now()},{passive:true,capture:true}));
  if(M)M.onFrame(onFrame);

  /* ---------- smear frames (stop motion; .sm only in hybrid) ---------- */
  function smear(el,cls,delay=83,len=120){
    if(!live||rm()||!el)return;const m=motion();
    if(!(m==='stop'||(m==='hybrid'&&el.closest('.sm'))))return;
    setTimeout(()=>{el.classList.add(cls);setTimeout(()=>el.classList.remove(cls),len)},delay);
  }
  let sheetWas=null,lastRoute='';
  const sheetObs=new MutationObserver(()=>{const s=document.getElementById('sheet');if(!s)return;const now=s.classList.contains('on');
    sheetWas=now}); // V2r1: no sheet smear (large-area blur)

  /* ---------- lifecycle ---------- */
  function setup(){
    fonts();addDefs();frames();hold();wobbleScale();setUi(0);setSm(0);decorate();
    const s=document.getElementById('sheet');if(s){sheetWas=s.classList.contains('on');sheetObs.observe(s,{attributes:true,attributeFilter:['class']})}
    if(!slowT)slowT=setInterval(slowTick,700);live=true;
  }
  function stop(){live=false;clearInterval(slowT);slowT=null;sheetObs.disconnect();teardown()}
  function sync(){if(on()&&!live)setup();else if(!on()&&live)stop();else if(live){wobbleScale();hold()}}
  new MutationObserver(sync).observe(R,{attributes:true,attributeFilter:['data-skin','data-motion']});
  RMq.addEventListener?.('change',()=>{if(live){wobbleScale();hold()}});
  document.addEventListener('halves:prefs',()=>{sync();if(live)hold()});
  document.addEventListener('halves:nudge',()=>{if(live)decorate()});
  document.addEventListener('halves:render',e=>{
    if(!live)return;decorate();
    const r=JSON.stringify(e.detail&&e.detail.route||'');
    lastRoute=r; // V2r1: no page smear (large-area blur); smear() stays available for small elements
  });
  sync();
})();
