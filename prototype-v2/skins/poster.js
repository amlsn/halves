/* Halves V2 · skin "poster" behaviour (DESIGN.md §9.1, §9.8 "Poster skin").
   Acts ONLY while html[data-skin="poster"]; watches the attribute so the skin can be switched live from Settings.
   - injects the Google Fonts <link> (Alfa Slab One / Oswald / Barlow / Yellowtail) on first activation
   - injects one hidden <svg id="pr-defs"> of <symbol>s: 4 painted frames each of sunburst rays + scalloped seal,
     and the original mascot "Dottie" (a pin-up-style badge, all drawn here) × 5 moods × 4 frames
   - fills .ornament[data-slot] and .mascot with <use> stacks (.pr-f, --k = frame); CSS swaps frames on steps() ≈12fps
     in data-motion="stop" (and inside .sm in hybrid); mood switching is pure CSS on [data-mood]
   - wraps the leading text of h2.sec in a ribbon banner (span.pr-rib)
   - Motion.boil() on big numbers/titles (misregistration jitters with --boil-j), cycles #pr-rough seed via Motion.onFrame
   Deactivation removes everything it added. Original artwork only: no brand marks, no copied artworks. */
(()=>{
  const R=document.documentElement;
  const on=()=>R.dataset.skin==='poster';
  const FONTS='https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Barlow:wght@400;500;600;700;800&family=Oswald:wght@400..700&family=Yellowtail&display=swap';
  const MOODS=['idle','happy','worried','sleepy','cheer'], FR=[0,1,2,3];
  const BOIL_SEL='.ptitle,.fhead h1'; // V2r1: titles only. Numbers you read at a glance never jitter.
  const rng=s=>()=>((s=(s*16807)%2147483647)-1)/2147483646;
  const n2=v=>+v.toFixed(2);

  /* ---------- shapes (96-pt polygons so they still morph with the base --sh-* set) ---------- */
  const polar=(fn,P=96)=>{const a=[];for(let i=0;i<P;i++){const t=i/P*Math.PI*2-Math.PI/2,r=fn(t);a.push(`${(50+r*Math.cos(t)).toFixed(2)}% ${(50+r*Math.sin(t)).toFixed(2)}%`)}return`polygon(${a.join(',')})`};
  const shapeCSS=()=>`html[data-skin="poster"]{--pr-scallop:${polar(t=>50*(1-.07)+50*.07*Math.cos(16*t))};--pr-scallop2:${polar(t=>50*(1-.11)+50*.11*Math.cos(12*t))};`+
    `--pr-cap:${polar(t=>50*(1-.05)+50*.05*Math.cos(24*t),288)}}`;

  /* ---------- painted ornaments ---------- */
  function rays(k,n=20){const r=rng(11+k*97);let d='';
    const p=(a,l)=>`${n2(Math.cos(a)*l)} ${n2(Math.sin(a)*l)}`;
    for(let i=0;i<n;i++){const a=i/n*Math.PI*2+(r()-.5)*.06,w=Math.PI/n*.5*(.85+r()*.3),L=50*(.88+r()*.12);
      d+=`M${p(a-w*.12,5)}L${p(a-w,L)}Q${p(a,L*(1.01+r()*.03))} ${p(a+w,L*(.95+r()*.05))}L${p(a+w*.12,5)}Z`}
    return`<symbol id="pr-rays-${k}" viewBox="-50 -50 100 100"><path d="${d}" style="fill:currentColor"/></symbol>`}
  function scallopPath(cx,cy,Rr,n,amp,rot,r){let d='';const P=n*8;
    for(let i=0;i<=P;i++){const t=i/P*Math.PI*2+rot,f=(i%8)/8,rr=Rr+amp*Math.sin(Math.PI*f)+(r?(r()-.5)*.5:0);
      d+=(i?'L':'M')+n2(cx+Math.cos(t)*rr)+' '+n2(cy+Math.sin(t)*rr)}return d+'Z'}
  function seal(k){const r=rng(301+k*13);
    return`<symbol id="pr-seal-${k}" viewBox="0 0 100 100"><path d="${scallopPath(50,50,40,18,4,k*.05,r)}" style="fill:none;stroke:currentColor;stroke-width:${n2(2.4+r()*.6)}"/>`+
      `<circle cx="50" cy="50" r="${n2(33+r())}" style="fill:none;stroke:currentColor;stroke-width:1.4;stroke-dasharray:${n2(2+r())} ${n2(3+r())}"/></symbol>`}

  /* ---------- mascot "Dottie": original pin-up-style badge (victory rolls, polka-dot bandana) ----------
     V2r1 (§9.1a): deadpan matchbook voice. Half-lidded eyes, no blush, a lipstick line instead of a smile, one raised brow
     for "happy", a single sparkle (no wink, no star burst) for "cheer". */
  const C={ink:'var(--pr-m-ink,#3A1118)',skin:'var(--pr-m-skin,#F5CDA6)',hair:'var(--pr-m-hair,#5A1A22)',band:'var(--pr-m-band,#C8372D)',
    dot:'var(--pr-m-dot,#FBEFD8)',badge:'var(--pr-m-badge,#E8B43A)',inner:'var(--pr-m-inner,#1E6E68)',lip:'var(--pr-m-lip,#B3232C)',
    blush:'var(--pr-m-blush,#E9837B)',blouse:'var(--pr-m-blouse,#7A1E2C)',collar:'var(--pr-m-dot,#FBEFD8)',drop:'#9FD3E6'};
  const S=(fill,stroke,w)=>`style="fill:${fill};stroke:${stroke||'none'};stroke-width:${w||0};stroke-linejoin:round;stroke-linecap:round"`;
  const star=(x,y,s,fill)=>`<path d="M${x},${y-s}Q${x+s*.18},${y-s*.18} ${x+s},${y}Q${x+s*.18},${y+s*.18} ${x},${y+s}Q${x-s*.18},${y+s*.18} ${x-s},${y}Q${x-s*.18},${y-s*.18} ${x},${y-s}Z" ${S(fill,C.ink,1.2)}/>`;
  const zee=(x,y,s)=>`<path d="M${x},${y}h${s}l-${s},${s*1.1}h${s}" ${S('none','var(--pr-m-z,#3A1118)',1.6)}/>`;
  function face(m,k){
    // half-lidded eye: a heavy lid line over a half-moon pupil (deadpan), or wide open for "worried"
    const lid=(x)=>`<path d="M${x-2.8},54.2Q${x},53.2 ${x+2.8},54.2" ${S('none',C.ink,1.5)}/><path d="M${x-1.9},54.4A1.9 1.7 0 0 0 ${x+1.9},54.4Z" ${S(C.ink)}/>`;
    const eyeO=(x)=>`<ellipse cx="${x}" cy="55" rx="1.6" ry="2.2" ${S(C.ink)}/>`;
    const arcDn=(x)=>`<path d="M${x-2.6},54.6Q${x},56.6 ${x+2.6},54.6" ${S('none',C.ink,1.5)}/>`;
    const brows=(l,r)=>`<path d="${l}" ${S('none',C.hair,1.5)}/><path d="${r}" ${S('none',C.hair,1.5)}/>`;
    const flat='M40,50.2Q43,49.6 46,50.2', level='M54,50.2Q57,49.6 60,50.2', raised='M54,48.2Q57,45.8 60.4,47.6';
    const line=`<path d="M46.2,63.4Q50,64.3 53.8,63.2" ${S('none',C.lip,1.9)}/>`;            // lipstick line, no smile
    const smirk=`<path d="M46.2,63.6Q50.4,64.4 54.2,62.3" ${S('none',C.lip,1.9)}/>`;
    switch(m){
      case'happy':return lid(43)+lid(57)+brows(flat,raised)+smirk;
      case'worried':return eyeO(43)+eyeO(57)+brows('M39.6,49.4L46,47.6','M54,47.6L60.4,49.4')+line+
        `<path d="M70,${41+k*.4}C67.6,${46+k*.4} 67.6,${48.6+k*.4} 70,${48.6+k*.4}C72.4,${48.6+k*.4} 72.4,${46+k*.4} 70,${41+k*.4}Z" ${S(C.drop,C.ink,1)}/>`;
      case'sleepy':return arcDn(43)+arcDn(57)+brows(flat,level)+line+zee(70,30-k*.8,5)+zee(78,19-k*.8,3.6);
      case'cheer':return lid(43)+lid(57)+brows(flat,raised)+smirk+star(85-k*.3,22,3.6+(k%2)*.6,C.dot);
      default:return lid(43)+lid(57)+brows(flat,level)+line;
    }
  }
  function mascot(m,k){const r=rng(500+k*31+m.length*7),sw=n2(2.4+r()*.5);
    const rot=[0,1.6,-1.2,.7][k],dx=[0,.4,-.35,.2][k],dy=[0,-.35,.2,.4][k];
    const dots=[[41,20],[56,19],[37,31],[46,28.6],[55,28.4],[63,31]].map(([x,y])=>`<circle cx="${n2(x+(r()-.5)*.5)}" cy="${n2(y+(r()-.5)*.5)}" r="1.15" ${S(C.dot)}/>`).join('');
    return`<symbol id="pr-m-${m}-${k}" viewBox="0 0 100 100">
<path d="${scallopPath(50,50,43,18,4.2,k*.04,r)}" ${S(C.badge,C.ink,sw)}/>
<circle cx="50" cy="50" r="35.5" ${S(C.inner,C.ink,1.6)}/>
<g transform="rotate(${rot} 50 72) translate(${dx} ${dy})">
<g clip-path="url(#pr-mclip)"><path d="M20,100C23,80 36,76.5 50,76.5C64,76.5 77,80 80,100Z" ${S(C.blouse,C.ink,1.6)}/>
<path d="M42,77L50,86.5L44.5,90.5ZM58,77L50,86.5L55.5,90.5Z" ${S(C.collar,C.ink,1.2)}/></g>
<rect x="46" y="66" width="8" height="12" ${S(C.skin,C.ink,1.2)}/>
<ellipse cx="50" cy="52" rx="23" ry="21" ${S(C.hair,C.ink,1.6)}/>
<circle cx="31.5" cy="61" r="5.8" ${S(C.hair,C.ink,1.4)}/><circle cx="68.5" cy="61" r="5.8" ${S(C.hair,C.ink,1.4)}/>
<ellipse cx="50" cy="56.4" rx="15.2" ry="18.6" ${S(C.skin,C.ink,sw*.8)}/>
<circle cx="33.6" cy="61.4" r="1.8" ${S(C.badge,C.ink,.8)}/><circle cx="66.4" cy="61.4" r="1.8" ${S(C.badge,C.ink,.8)}/>
<path d="M33.6,51C33,40 41,34.6 50,36C59,34.6 67,40 66.4,51C62.6,44.6 57,42.8 50,43.6C43,42.8 37.4,44.6 33.6,51Z" ${S(C.hair,C.ink,1.3)}/>
<circle cx="39.5" cy="34.5" r="8" ${S(C.hair,C.ink,1.6)}/><circle cx="60.5" cy="34.5" r="8" ${S(C.hair,C.ink,1.6)}/>
<path d="M39,32.6C38,32 39.6,29.4 41.6,30.4M61,32.6C62,32 60.4,29.4 58.4,30.4" ${S('none',C.ink,1)}/>
<path d="M32.5,32C40,24.5 60,24.5 67.5,32L66,36.4C58,30.6 42,30.6 34,36.4Z" ${S(C.band,C.ink,1.5)}/>
<path d="M50,26.5L40.5,${16.5+(k%2)*.6}L43,28ZM50,26.5L59.5,${16.5+(k%3)*.4}L57,28Z" ${S(C.band,C.ink,1.5)}/>
<circle cx="50" cy="26.8" r="3" ${S(C.band,C.ink,1.4)}/>${dots}
${face(m,k)}</g></symbol>`;
  }
  function defsHTML(){
    let s='<svg id="pr-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>'+
      '<clipPath id="pr-mclip"><circle cx="50" cy="50" r="35"/></clipPath>'+
      '<filter id="pr-rough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>';
    FR.forEach(k=>{s+=rays(k)+seal(k)});
    MOODS.forEach(m=>FR.forEach(k=>{s+=mascot(m,k)}));
    return s+'</defs></svg>';
  }
  const stack=(id,cls='')=>FR.map(k=>`<use href="#${id}-${k}" width="100" height="100" class="pr-f pr-k${k} ${cls}" style="--k:${k}"/>`).join('');
  const ORN={
    hero:()=>`<svg class="pr-art pr-spin" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${stack('pr-rays')}</svg>`,
    today:()=>ORN.hero(),
    folder:()=>`<svg class="pr-art pr-spin" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${stack('pr-rays')}</svg>`,
    empty:()=>`<svg class="pr-art" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g class="pr-spin-g">${stack('pr-rays','pr-ray')}</g>${stack('pr-seal','pr-sealu')}</svg>`,
    nudge:()=>ORN.empty()
  };
  const mascotHTML=()=>`<svg class="pr-art pr-mascot" viewBox="0 0 100 100" aria-hidden="true" focusable="false">`+
    MOODS.map(m=>`<g class="pr-mood pr-mood-${m}">${stack('pr-m-'+m)}</g>`).join('')+'</svg>';

  /* ---------- apply / remove ---------- */
  let mo=null,queued=false,frameHooked=false;
  function boot(){
    if(!document.getElementById('pr-fonts')){const l=document.createElement('link');l.id='pr-fonts';l.rel='stylesheet';l.href=FONTS;document.head.appendChild(l)}
    if(!document.getElementById('pr-shapes')){const st=document.createElement('style');st.id='pr-shapes';st.textContent=shapeCSS();document.head.appendChild(st)}
    if(!document.getElementById('pr-defs'))document.body.insertAdjacentHTML('afterbegin',defsHTML());
    if(!frameHooked&&typeof Motion!=='undefined'&&Motion.onFrame){frameHooked=true;
      const t=()=>document.querySelector('#pr-rough feTurbulence');
      Motion.onFrame(f=>{if(on()&&t())t().setAttribute('seed',3+f*5)})}
  }
  function fill(){
    if(!on())return;
    document.querySelectorAll('.ornament[data-slot]').forEach(o=>{if(!o.querySelector(':scope>.pr-art')&&ORN[o.dataset.slot])o.innerHTML=ORN[o.dataset.slot]()});
    document.querySelectorAll('.mascot').forEach(m=>{if(!m.querySelector(':scope>.pr-art'))m.innerHTML=mascotHTML()});
    // V2r2: one ribbon per screen (the first section head = the thing to act on); the rest get the plain rule-line head
    const firstSec=document.querySelector('#main h2.sec');
    document.querySelectorAll('h2.sec').forEach(h=>{h.classList.toggle('pr-plain',h!==firstSec&&!!h.closest('#main'));if(h!==firstSec&&h.closest('#main'))return;if(h.querySelector(':scope>.pr-rib'))return;
      const t=[...h.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
      if(t){const s=document.createElement('span');s.className='pr-rib';s.textContent=t.textContent.trim();t.replaceWith(s,' ')}});
    document.querySelectorAll(BOIL_SEL).forEach(el=>{if(el.classList.contains('boil'))return;el.dataset.prBoil='1';
      if(typeof Motion!=='undefined'&&Motion.boil)Motion.boil(el);else el.classList.add('boil')});
  }
  function clear(){
    document.querySelectorAll('.ornament>.pr-art,.mascot>.pr-art').forEach(e=>e.remove());
    document.querySelectorAll('.pr-rib').forEach(s=>s.replaceWith(document.createTextNode(s.textContent)));
    document.querySelectorAll('.pr-plain').forEach(h=>h.classList.remove('pr-plain'));
    document.querySelectorAll('[data-pr-boil]').forEach(e=>{e.classList.remove('boil');e.style.removeProperty('--boil');e.style.removeProperty('--boil-j');delete e.dataset.prBoil});
  }
  const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;fill()})};
  function sync(){
    if(on()){boot();fill();
      if(!mo){mo=new MutationObserver(schedule);mo.observe(document.body,{childList:true,subtree:true})}}
    else{if(mo){mo.disconnect();mo=null}clear()}
  }
  new MutationObserver(sync).observe(R,{attributes:true,attributeFilter:['data-skin']});
  ['halves:render','halves:prefs','halves:nudge'].forEach(e=>document.addEventListener(e,()=>{if(on())schedule()}));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync);else sync();
})();
