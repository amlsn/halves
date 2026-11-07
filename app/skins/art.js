/* Halves V2 · exploration skin "art": classical + psychedelic (DESIGN.md §9.10 "Art skin").
   Acts ONLY while html[data-skin="art"]; watches the attribute and removes everything it added when you switch away.
   All artwork is generated here, procedurally, as original SVG (nothing copied or traced):
   - a Hokusai-style great wave (curling lip, claw-like foam fingers, spray) in the hero / Trends "Today" ornament slots
   - Van Gogh-style impasto swirl tiles (strokes following a periodic vortex flow field) → CSS vars for cards, fills, page
   - a swirling star (moon when sleepy) as the .mascot, a spiral halo for the folder / empty / nudge slots
   - the dial ring becomes a two-layer swirl that follows the dial with momentum (spring: lag + overshoot, inner layer faster)
   - sliders (.xs) fill like a cresting wave: the crest grows with drag speed, flips when the wave retreats, splashes at detents
   Game-feel never touches hit targets: the slider value/ARIA/pointer capture stay instant, only the paint lags.
   Perf: rAF loops run only while something is settling; stop motion writes at ~12fps; hidden tab → CSS animations paused;
   prefers-reduced-motion → no loops, no splashes (the base reset already stops CSS animation). */
(()=>{
  const R=document.documentElement;
  const on=()=>R.dataset.skin==='art';
  const RM=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
  const STOP=()=>R.dataset.motion==='stop';
  const FONTS='https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..900,0..100,0..1;1,9..144,300..900,0..100,0..1&family=DM+Sans:opsz,wght@9..40,400..800&display=swap';
  const rng=s=>()=>((s=(s*16807)%2147483647)-1)/2147483646;
  const f1=v=>Math.round(v*10)/10;
  const P=a=>a.map(p=>f1(p[0])+','+f1(p[1])).join(' ');
  const uri=svg=>`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

  /* ---------- Van Gogh impasto tile: short brush strokes along a seamless (toroidal) vortex flow field ---------- */
  function swirlTile({seed=7,W=200,step=11,len=[4,8],sw=[1.6,3],cols,op=[.6,1],vort=6,flow=[.3,.1]}){
    const r=rng(seed),V=[];
    for(let i=0;i<vort;i++)V.push({x:r()*W,y:r()*W,s:(r()<.5?-1:1)*(.7+r()*.6),R:W*(.1+r()*.12)});
    const field=(x,y)=>{let vx=flow[0],vy=flow[1];
      for(const v of V)for(let ox=-W;ox<=W;ox+=W)for(let oy=-W;oy<=W;oy+=W){
        const dx=x-v.x-ox,dy=y-v.y-oy,d=Math.hypot(dx,dy)+.001,w=v.s*Math.exp(-d*d/(2*v.R*v.R))*1.8;vx+=-dy/d*w;vy+=dx/d*w}
      const m=Math.hypot(vx,vy)||1;return[vx/m,vy/m]};
    const by={};
    for(let gx=0;gx<W;gx+=step)for(let gy=0;gy<W;gy+=step){
      let x=gx+r()*step,y=gy+r()*step;const pts=[[x,y]],n=len[0]+Math.floor(r()*(len[1]-len[0]+1));
      for(let k=0;k<n;k++){const[vx,vy]=field(x,y);x+=vx*2.4;y+=vy*2.4;pts.push([x,y])}
      const c=cols[Math.floor(r()*cols.length)],w=f1(sw[0]+r()*(sw[1]-sw[0])),o=(op[0]+r()*(op[1]-op[0])).toFixed(2);
      const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
      const offs=[[0,0]];
      [[-W,0],[W,0],[0,-W],[0,W],[-W,-W],[W,W],[-W,W],[W,-W]].forEach(([ox,oy])=>{
        if(Math.min(...xs)+ox<W&&Math.max(...xs)+ox>0&&Math.min(...ys)+oy<W&&Math.max(...ys)+oy>0)offs.push([ox,oy])});
      offs.forEach(([ox,oy])=>{(by[c]=by[c]||[]).push(`<path d="M${P(pts.map(p=>[p[0]+ox,p[1]+oy])).replace(/ /g,'L')}" stroke-width="${w}" stroke-opacity="${o}"/>`)});
    }
    const g=Object.entries(by).map(([c,ps])=>`<g stroke="${c}">${ps.join('')}</g>`).join('');
    return uri(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" fill="none" stroke-linecap="round" stroke-linejoin="round">${g}</svg>`);
  }
  /* ragged brush edge for fills (mask, right end) */
  const BRUSH_EDGE=uri(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" viewBox="0 0 10 20" preserveAspectRatio="none"><path d="M0 0H5.5C7.5 2 6 4 8.2 5.8 9.6 7.4 7.4 9 9.4 11 10 12.4 7.8 14 8.6 16.2 9 18 6.5 18.6 6 20H0Z"/></svg>`);
  /* slider crest (leading edge of the "you" fill), curls rightward; foam claws in cream */
  const crestSVG=(body,foam)=>uri(`<svg xmlns="http://www.w3.org/2000/svg" width="34" height="66" viewBox="0 0 34 66">`+
    `<path fill="${body}" d="M0 66V22C7 20 11 14 15 8 19 2 27 0 31 5 34 9 32 15 27 15 24 15 23 12 25 10 21 8 17 13 16 20 15 32 18 50 24 66Z"/>`+
    `<path fill="none" stroke="${foam}" stroke-width="2.4" stroke-linecap="round" d="M1 22.6C7 20.6 11 14.6 15 8.6 19 2.8 26.6 .9 30.4 5.6"/>`+
    `<g fill="${foam}"><path d="M29 2.6 33.6 0 31.8 4.4Z"/><path d="M31.6 8 34 6.6 33 10.6 30.6 9.6Z"/><path d="M30 12.4 33.4 13.6 29.4 15.4Z"/><path d="M22 2.2 25 0 24.6 3.4Z"/><circle cx="26" cy="1.2" r=".9"/><circle cx="33" cy="16.6" r=".8"/></g></svg>`);

  /* ---------- the great wave (viewBox 240×160, curls to the left, lip/claws generated) ---------- */
  const LIP=[[[176,9],[144,7],[114,21],[98,45]],[[98,45],[89,58],[90,73],[101,79]],[[101,79],[109,83],[117,77],[114,69]]];
  const BODY='M264,160 L264,70 C250,34 214,10 176,9 C144,7 114,21 98,45 C89,58 90,73 101,79 C109,83 117,77 114,69 C127,76 135,94 129,113 C124,129 111,142 88,150 C58,158 28,157 0,160 Z';
  const bz=(a,b,c,d,t)=>{const u=1-t;return[0,1].map(i=>u*u*u*a[i]+3*u*u*t*b[i]+3*u*t*t*c[i]+t*t*t*d[i])};
  function lip(n=14){const pts=[];LIP.forEach(s=>{for(let i=0;i<n;i++)pts.push(bz(...s,i/n))});pts.push(LIP[2][3]);
    return pts.map((p,i)=>{const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];let dx=b[0]-a[0],dy=b[1]-a[1];const m=Math.hypot(dx,dy)||1;dx/=m;dy/=m;
      return{p,d:[dx,dy],n:[-dy,dx],u:i/(pts.length-1)}})}
  let uid=0;
  function waveSVG(seed){
    const r=rng(seed),L=lip(),id='aw'+(++uid),add=(p,v,k)=>[p[0]+v[0]*k,p[1]+v[1]*k];
    // foam band along the lip (thick at the crest, tapering into the back and at the curl tip), ragged inner edge
    const outer=L.map(s=>s.p),inner=L.map(s=>add(s.p,s.n,-(2+5.5*Math.pow(Math.sin(Math.PI*Math.min(1,s.u*1.15)),.7)+r()*1.4))).reverse();
    const foam=`<path class="aw-foam" d="M${P(outer.concat(inner)).replace(/ /g,'L')}Z"/>`;
    // claw fingers: a main hook reaching out and curling along the break direction, two smaller tines either side
    let claws='';
    const hook=(p,n,d,Lc,w)=>{const tip=add(add(p,n,Lc*.85),d,Lc*.75),c1=add(add(p,n,Lc*1.05),d,w*.4),c2=add(add(p,n,Lc*.45),d,-w*.1);
      return`M${P([add(p,d,w)])}Q${P([c1])} ${P([tip])}Q${P([c2])} ${P([add(p,d,-w)])}Z`};
    L.forEach((s,i)=>{if(s.u<.28||s.u>.97)return;const amp=.55+.6*Math.sin(Math.PI*s.u),Lc=(8+r()*8)*amp;
      claws+=hook(s.p,s.n,s.d,Lc,2.4)+hook(add(s.p,s.d,2.6),s.n,s.d,Lc*.55,1.4)+hook(add(s.p,s.d,-2.6),s.n,s.d,Lc*.5,1.3)});
    // water lines inside the body (parallel to the lip), clipped to the body
    let lines='';[9,15,21,28,35,43].forEach((k,j)=>{const seg=L.filter(s=>s.u<.66-j*.03).map(s=>add(s.p,s.n,-k-r()*1.5));lines+=`<path d="M${P(seg).replace(/ /g,'L')}"/>`});
    lines+='<path d="M232,70 C214,40 196,30 176,26"/><path d="M226,96 C210,64 190,50 168,46"/><path d="M220,124 C206,96 186,76 160,70"/>';
    // spray off the crest
    let spray='';for(let i=0;i<18;i++){const s=L[3+Math.floor(r()*(L.length-8))],q=add(add(s.p,s.n,10+r()*14),s.d,(r()-.5)*10);spray+=`<circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="${f1(.6+r()*1.3)}"/>`}
    return`<svg class="art-o art-wave" viewBox="0 0 240 160" preserveAspectRatio="xMaxYMin meet" aria-hidden="true" focusable="false">
      <defs><clipPath id="${id}"><path d="${BODY}"/></clipPath></defs>
      <g class="aw-far art-a"><path class="aw-farb" d="M0,160 L0,134 C14,126 26,120 38,124 C46,127 46,134 40,135 C52,132 62,140 70,150 L76,160Z M52,160 C70,146 86,138 100,141 C108,143 108,149 103,150 C112,150 120,155 126,160Z"/>
        <path class="aw-farf" d="M2,133 C14,126 26,121 37,124.5 M70,145 C84,139 96,138 104,142"/></g>
      <g class="aw-main art-a"><path class="aw-body" d="${BODY}"/><g class="aw-lines" clip-path="url(#${id})">${lines}</g>${foam}
        <g class="aw-claws art-a"><path class="aw-foam" d="${claws}"/></g></g>
      <g class="aw-spray art-a">${spray}</g>
      <g class="aw-front art-a"><path class="aw-deep" d="M118,160 C146,145 176,139 202,145 C224,150 244,155 262,158 L262,160Z"/><path class="aw-farf" d="M126,157 C150,146 176,141 200,146.5"/></g>
    </svg>`;
  }

  /* ---------- spiral halo (mascot star, folder / empty / nudge slots) ---------- */
  function haloG(seed,rings=[20,27,34,41]){const r=rng(seed);let s='';
    rings.forEach((R0,ri)=>{const n=4+ri,ph=r()*6.28;for(let k=0;k<n;k++){const a0=ph+k*6.283/n,sp=6.283/n*(.55+r()*.25),pts=[];
      for(let t=0;t<=8;t++){const a=a0+sp*t/8,rr=R0+t*.55;pts.push([50+rr*Math.cos(a),50+rr*Math.sin(a)])}
      s+=`<path class="ah-${(ri+k)%3}" stroke-width="${f1(3.4-ri*.45)}" d="M${P(pts).replace(/ /g,'L')}"/>`}});
    return`<g class="as-halo art-a" fill="none" stroke-linecap="round">${s}</g>`}
  const haloSVG=seed=>`<svg class="art-o art-halo" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${haloG(seed,[14,22,30,38,46])}</svg>`;
  function starSVG(){let rays='';for(let i=0;i<12;i++){const a=i*Math.PI/6,c=Math.cos(a),s=Math.sin(a);rays+=`<path d="M${f1(50+44*c)},${f1(50+44*s)}L${f1(50+49*c)},${f1(50+49*s)}"/>`}
    return`<svg class="art-o art-star" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${haloG(11)}
      <g class="as-sun"><circle class="as-core" cx="50" cy="50" r="13"/><circle class="as-hi" cx="50" cy="50" r="7"/></g>
      <path class="as-moon" d="M55,30 A21,21 0 1,0 70,62 A16,16 0 1,1 55,30Z"/>
      <g class="as-rays art-a" stroke-linecap="round">${rays}</g></svg>`}

  /* ---------- dial swirl (viewBox -50..50; two layers of spiral brush dashes) ---------- */
  function dialSVG(){const r=rng(29);const layer=(r0,r1,arms,cls)=>{let s='';
      for(let a=0;a<arms;a++){const base=a*6.283/arms;let rr=r1;let th=base;
        while(rr>r0){const seg=[];for(let k=0;k<6;k++){seg.push([rr*Math.cos(th),rr*Math.sin(th)]);th+=.07;rr-=.42}
          s+=`<path class="ad-${Math.floor(r()*4)}" stroke-width="${f1(2+r()*2.2)}" d="M${P(seg).replace(/ /g,'L')}"/>`;th+=.05+r()*.06;rr-=.6}}
      return`<g class="${cls}">${s}</g>`};
    return`<svg class="art-o art-dswirl" viewBox="-50 -50 100 100" aria-hidden="true" focusable="false"><g fill="none" stroke-linecap="round">${layer(34,49,5,'ad-out')}${layer(21,34,4,'ad-in')}</g></svg>`}

  /* ---------- textures → CSS vars on <html> (removed on deactivate) ---------- */
  let texDone=false;
  const VARS=()=>({
    '--art-tex-l':swirlTile({seed:7,cols:['#1F4673','#3D6FA8','#B8642A','#D9A441'],op:[.55,.95]}),
    '--art-tex-d':swirlTile({seed:7,cols:['#5F8FD0','#9CBDEB','#F2C14E','#E9E2CF'],op:[.5,.9]}),
    '--art-tex-fill':swirlTile({seed:13,W:120,step:8,len:[3,6],sw:[1.2,2.4],cols:['#FFFFFF','#000000'],op:[.18,.38],vort:4}),
    '--art-page-l':swirlTile({seed:3,W:320,step:22,len:[5,9],sw:[2,3.4],cols:['#1F4673','#B8642A'],op:[.03,.05],vort:7}),
    '--art-page-d':swirlTile({seed:3,W:320,step:18,len:[5,9],sw:[1.8,3.2],cols:['#3E6FB0','#F2C14E','#8DB3E8'],op:[.05,.09],vort:7}),
    '--art-crest-l':crestSVG('#1F4E8C','#F7F0E0'),'--art-crest-d':crestSVG('#6E9BDB','#F7F0E0'),
    '--art-brush-edge':BRUSH_EDGE});
  function textures(){if(texDone)return;texDone=true;const v=VARS();for(const k in v)R.style.setProperty(k,v[k])}

  /* ---------- dial: swirl follows dial.ticks with momentum ---------- */
  let dialObs=null,dial={a:0,v:0,T:0,raf:0,last:0,acc:0};
  const dialAngle=()=>{const t=document.getElementById('dialTicks');const m=t&&/rotate\((-?[\d.]+)deg\)/.exec(t.style.transform);return m?+m[1]:0};
  function dialPaint(){const s=document.querySelector('#dialRing>.art-dswirl');if(!s)return;
    s.querySelector('.ad-out').setAttribute('transform',`rotate(${f1(dial.a)})`);s.querySelector('.ad-in').setAttribute('transform',`rotate(${f1(dial.a*1.55)})`)}
  function dialLoop(t){dial.raf=0;if(!on())return;const dt=Math.min(.05,(t-(dial.last||t))/1000);dial.last=t;
    const acc=90*(dial.T-dial.a)-11*dial.v;dial.v+=acc*dt;dial.a+=dial.v*dt;
    dial.acc+=dt;if(!STOP()||dial.acc>=.083){dial.acc=0;dialPaint()}
    if(Math.abs(dial.T-dial.a)>.05||Math.abs(dial.v)>.05)dial.raf=requestAnimationFrame(dialLoop);else{dial.a=dial.T;dial.v=0;dial.last=0;dialPaint()}}
  function dialBind(){const ring=document.getElementById('dialRing'),ticks=document.getElementById('dialTicks');if(!ring||!ticks)return;
    if(!ring.querySelector(':scope>.art-dswirl')){ring.insertAdjacentHTML('afterbegin',dialSVG());dial.T=dial.a=dialAngle();dial.v=0;dialPaint()}
    if(!dialObs){dialObs=new MutationObserver(()=>{if(!on())return;dial.T=dialAngle();
        if(RM()){dial.a=dial.T;dialPaint();return}
        dial.v+=(dial.T-dial.a)*1.8; // a flick adds spin: the paint keeps travelling past the detent, then springs back
        if(!dial.raf)dial.raf=requestAnimationFrame(dialLoop)});
      dialObs.observe(ticks,{attributes:true,attributeFilter:['style']})}}

  /* ---------- sliders: cresting wave with weight, surge and splash ---------- */
  const DETENTS=[0,25,50,75,100],xsState=new Map();
  function splash(el,big){if(RM()||!el.isConnected)return;const a=el.querySelector('.a');if(!a)return;
    const x=a.offsetLeft+a.offsetWidth+3,n=big?6:4;
    for(let i=0;i<n;i++){const d=document.createElement('i');d.className='art-drop';const ang=-Math.PI*(.15+.7*i/(n-1)),sp=(big?22:15)*(.7+Math.random()*.5);
      d.style.cssText=`left:${x}px;--dx:${f1(Math.cos(ang)*sp)}px;--dy:${f1(Math.sin(ang)*sp)}px;--s:${f1(.6+Math.random()*.6)}`;el.appendChild(d);setTimeout(()=>d.remove(),650)}
    const ring=document.createElement('i');ring.className='art-ripple';ring.style.left=x+'px';el.appendChild(ring);setTimeout(()=>ring.remove(),650)}
  function xsLoop(el,st){st.raf=0;if(!el.isConnected||!on())return;
    const now=performance.now(),dt=Math.min(.1,(now-st.t)/1000);st.t=now;st.surge*=Math.pow(.02,dt); // decays to ~2% in 1s
    st.acc+=dt;if(!STOP()||st.acc>=.083){st.acc=0;el.style.setProperty('--art-surge',st.surge.toFixed(3))}
    if(st.surge>.01)st.raf=requestAnimationFrame(()=>xsLoop(el,st));else el.style.setProperty('--art-surge','0')}
  function xsBind(el){if(xsState.has(el))return;
    const st={v:+el.getAttribute('aria-valuenow')||0,t:performance.now(),surge:0,raf:0,acc:0,moved:false};
    const mo=new MutationObserver(()=>{if(!on())return;const nv=+el.getAttribute('aria-valuenow'),now=performance.now();if(nv===st.v)return;
      const dv=nv-st.v,dt=Math.max(16,now-st.t);st.moved=true;
      el.style.setProperty('--art-dir',dv>=0?'1':'-1');
      if(!RM()){st.surge=Math.min(1,st.surge*.6+Math.abs(dv)/dt*6);st.t=now;el.style.setProperty('--art-surge',st.surge.toFixed(3));
        if(!st.raf)st.raf=requestAnimationFrame(()=>xsLoop(el,st));
        if(DETENTS.includes(nv))splash(el,false)}
      st.v=nv;st.t=now});
    mo.observe(el,{attributes:true,attributeFilter:['aria-valuenow']});
    const up=()=>{if(st.moved&&on())splash(el,true);st.moved=false};
    el.addEventListener('pointerup',up);
    xsState.set(el,{mo,up,st})}
  function xsUnbindAll(){xsState.forEach(({mo,up,st},el)=>{mo.disconnect();el.removeEventListener('pointerup',up);if(st.raf)cancelAnimationFrame(st.raf);
    el.style.removeProperty('--art-surge');el.style.removeProperty('--art-dir');el.querySelectorAll('.art-drop,.art-ripple').forEach(d=>d.remove())});xsState.clear()}

  /* ---------- apply / remove ---------- */
  const ORN={hero:()=>waveSVG(5),today:()=>waveSVG(17),folder:()=>haloSVG(41),empty:()=>haloSVG(43),nudge:()=>haloSVG(47)};
  const onVis=()=>R.classList.toggle('art-paused',on()&&document.hidden);
  let mo=null,queued=false;
  function boot(){
    if(!document.getElementById('art-fonts')){const l=document.createElement('link');l.id='art-fonts';l.rel='stylesheet';l.href=FONTS;document.head.appendChild(l)}
    textures();dialBind();document.addEventListener('visibilitychange',onVis);onVis();
  }
  function fill(){if(!on())return;
    document.querySelectorAll('.ornament[data-slot]').forEach(o=>{if(!o.querySelector(':scope>.art-o')&&ORN[o.dataset.slot])o.innerHTML=ORN[o.dataset.slot]()});
    document.querySelectorAll('.mascot').forEach(m=>{if(!m.querySelector(':scope>.art-o'))m.innerHTML=starSVG()});
    document.querySelectorAll('.xs').forEach(xsBind);
    xsState.forEach((v,el)=>{if(!el.isConnected){v.mo.disconnect();if(v.st.raf)cancelAnimationFrame(v.st.raf);xsState.delete(el)}});
  }
  function clear(){
    document.querySelectorAll('.art-o').forEach(e=>e.remove());
    xsUnbindAll();
    if(dialObs){dialObs.disconnect();dialObs=null}if(dial.raf){cancelAnimationFrame(dial.raf);dial.raf=0}
    document.removeEventListener('visibilitychange',onVis);R.classList.remove('art-paused');
    if(texDone){Object.keys(VARS_KEYS).forEach(k=>R.style.removeProperty(k));texDone=false}
    const l=document.getElementById('art-fonts');if(l)l.remove();
  }
  const VARS_KEYS={'--art-tex-l':1,'--art-tex-d':1,'--art-tex-fill':1,'--art-page-l':1,'--art-page-d':1,'--art-crest-l':1,'--art-crest-d':1,'--art-brush-edge':1};
  const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;fill()})};
  let active=false;
  function sync(){
    if(on()){boot();fill();active=true;
      if(!mo){mo=new MutationObserver(schedule);mo.observe(document.body,{childList:true,subtree:true})}}
    else if(active){active=false;if(mo){mo.disconnect();mo=null}clear()}
  }
  new MutationObserver(sync).observe(R,{attributes:true,attributeFilter:['data-skin']});
  ['halves:render','halves:prefs','halves:nudge'].forEach(e=>document.addEventListener(e,()=>{if(on())schedule()}));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync);else sync();
})();
