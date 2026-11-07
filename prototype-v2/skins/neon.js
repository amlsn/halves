/* Halves V2 · exploration skin "neon": 80s Las Vegas neon (DESIGN.md §9.10, "Neon skin").
   Acts ONLY while html[data-skin="neon"]; watches the attribute so the skin can be switched live from Settings,
   and removes everything it added (fonts link, classes, inline props, observers, listeners, audio, timers) on switch-away.
   - injects Google Fonts: Tilt Neon (tube lettering: titles + numbers), Manrope (UI/body), Monoton (brand only)
   - sliders (.xs): sets --nn-v (0..1 charge) on each, marks single-tube sliders (.nn-charge), flash-snaps at detents/full,
     and plays a quiet WebAudio mains hum while dragging (gain/brightness follow the charge; off if the dial sound is off)
   - thumb dial: ticks light up (cyan) as they pass the fixed pointer during a turn; full ring = flash; fades after the turn
   - buttons ignite on press (a class added on pointerdown; purely visual, never delays the tap)
   - idle flicker: rarely (7–16s, only after 2.5s without input, dark mode only) one visible sign stutters faintly.
     None under prefers-reduced-motion, none while the tab is hidden.
   Original work only: no real casino or brand signage. */
(()=>{
  const R=document.documentElement;
  const on=()=>R.dataset.skin==='neon';
  const FONTS='https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Monoton&family=Tilt+Neon&display=swap';
  const RM=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
  const IGN='.pill-btn,.save,.later-btn,.fab,.chip,.dchip,.key,.tb,.icon-btn,.seg button,.text-btn,.sortq,.qtitles button,.catb,.switch,.dial-core,.days button,.crumb,.tcard,.subtile,.split-ctl,.bgroup button,.pdot';
  const FLICK='.topbar .brand,.rail .brand-i,.ptitle,.fhead h1,.hero .ring,.today .ring,.tcard .ring,.tgt-card .bar2,.ornament[data-slot],.treepane h2';
  let active=false, mo=null, xsMo=null, tickMo=null, flickT=null, lastInput=0, ac=null, hum=null;
  const cleanups=[];
  const listen=(t,ev,f,o)=>{t.addEventListener(ev,f,o);cleanups.push(()=>t.removeEventListener(ev,f,o))};

  /* ---------- audio: quiet mains hum + zap (shares nothing with the app's AudioContext) ---------- */
  const soundOn=()=>{try{return typeof dial==='undefined'||dial.sound!==false}catch(e){return true}};
  function ctx(){try{ac=ac||new(window.AudioContext||window.webkitAudioContext)();if(ac.state==='suspended')ac.resume();return ac}catch(e){return null}}
  function humStart(v){
    if(hum||!soundOn())return;const a=ctx();if(!a)return;
    const g=a.createGain(),f=a.createBiquadFilter(),o1=a.createOscillator(),o2=a.createOscillator();
    o1.type='sawtooth';o1.frequency.value=100;o2.type='square';o2.frequency.value=120.6; // mains-ish buzz, slight beat
    f.type='lowpass';f.Q.value=2;f.frequency.value=300;g.gain.value=0;
    o1.connect(f);o2.connect(f);f.connect(g).connect(a.destination);o1.start();o2.start();
    hum={g,f,o1,o2};humSet(v);
  }
  function humSet(v){if(!hum||!ac)return;const t=ac.currentTime;
    hum.g.gain.setTargetAtTime(.004+.018*v,t,.05);hum.f.frequency.setTargetAtTime(260+1500*v,t,.05)}
  function humStop(){if(!hum||!ac)return;const h=hum;hum=null;const t=ac.currentTime;
    h.g.gain.setTargetAtTime(0,t,.04);setTimeout(()=>{try{h.o1.stop();h.o2.stop();h.g.disconnect()}catch(e){}},250)}
  function zap(strong){
    if(!soundOn())return;const a=ctx();if(!a)return;
    try{const n=Math.round(a.sampleRate*(strong?.07:.035)),b=a.createBuffer(1,n,a.sampleRate),d=b.getChannelData(0);
      for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,2);
      const s=a.createBufferSource(),f=a.createBiquadFilter(),g=a.createGain();f.type='bandpass';f.frequency.value=strong?2400:3600;f.Q.value=3;
      g.gain.value=strong?.09:.05;s.buffer=b;s.connect(f).connect(g).connect(a.destination);s.start()}catch(e){}
  }

  /* ---------- sliders: charge, detents, hum ---------- */
  const flash=(el,cls,ms)=>{el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);setTimeout(()=>el.classList.remove(cls),ms)};
  function detents(el){const mn=+el.getAttribute('aria-valuemin')||0,mx=+el.getAttribute('aria-valuemax')||100;
    return /settle/i.test(el.getAttribute('aria-label')||'')?[mn+(mx-mn)*.25,mn+(mx-mn)*.5,mn+(mx-mn)*.75,mx]:[mn,(mn+mx)/2,mx]}
  function xsRead(el,fx){
    const mn=+el.getAttribute('aria-valuemin')||0,mx=+el.getAttribute('aria-valuemax')||100,v=+el.getAttribute('aria-valuenow');
    if(!isFinite(v))return;const p=Math.max(0,Math.min(1,(v-mn)/(mx-mn||1)));
    el.style.setProperty('--nn-v',p.toFixed(3));
    if(el.classList.contains('drag'))humSet(el.classList.contains('nn-charge')?p:Math.abs(p-.5)*1.2+.3);
    if(fx&&el._nnLast!==undefined&&v!==el._nnLast&&detents(el).includes(v)){
      const full=v===mx&&el.classList.contains('nn-charge');
      flash(el,full?'nn-full':'nn-snap',full?520:260);zap(full);
    }
    el._nnLast=v;
  }
  function xsAttach(el){
    if(el._nnOn)return;el._nnOn=true;el.classList.add('nn-xs');
    const b=el.querySelector('.b');
    if((b&&b.style.background)||/settle/i.test(el.getAttribute('aria-label')||''))el.classList.add('nn-charge');
    xsRead(el,false);xsMo.observe(el,{attributes:true,attributeFilter:['aria-valuenow','class']});
  }
  function xsDetach(el){el._nnOn=false;el._nnLast=undefined;el.classList.remove('nn-xs','nn-charge','nn-snap','nn-full');el.style.removeProperty('--nn-v')}
  function onXsMut(ms){for(const m of ms){const el=m.target;
    if(m.attributeName==='aria-valuenow')xsRead(el,true);
    else if(m.attributeName==='class'){const d=el.classList.contains('drag');
      if(d&&!el._nnDrag){el._nnDrag=true;const p=+getComputedStyle(el).getPropertyValue('--nn-v')||0;humStart(el.classList.contains('nn-charge')?p:.5)}
      else if(!d&&el._nnDrag){el._nnDrag=false;humStop()}}}}

  /* ---------- dial: tick ring lights as you turn ---------- */
  let dState={last:null,lit:new Set(),fadeT:null};
  function dialTicks(){const t=document.getElementById('dialTicks');return t?[...t.children]:[]}
  function onTicks(){
    const T=document.getElementById('dialTicks'),D=document.getElementById('dial');if(!T||!D)return;
    const m=/rotate\((-?[\d.]+)deg\)/.exec(T.style.transform||'');if(!m)return;
    const n=Math.round(parseFloat(m[1])/15),ticks=dialTicks(),N=ticks.length||24;
    if(dState.last===null)dState.last=0;
    const step=Math.sign(n-dState.last);
    for(let k=dState.last;k!==n;k+=step){const at=k+step,idx=((-at)%N+N)%N;
      if(ticks[idx]){ticks[idx].classList.add('nn-lit');dState.lit.add(idx)}}
    dState.last=n;
    D.style.setProperty('--nn-charge',(dState.lit.size/N).toFixed(3));
    if(dState.lit.size>=N&&!D.classList.contains('nn-full')){flash(D,'nn-full',600);zap(true)}
    clearTimeout(dState.fadeT);
    const fade=()=>{if(D.classList.contains('turning')){dState.fadeT=setTimeout(fade,300);return}
      ticks.forEach(t=>t.classList.remove('nn-lit'));dState.lit.clear();D.style.setProperty('--nn-charge','0')};
    dState.fadeT=setTimeout(fade,650);
  }
  function dialReset(){clearTimeout(dState.fadeT);dialTicks().forEach(t=>t.classList.remove('nn-lit'));dState={last:null,lit:new Set(),fadeT:null};
    const D=document.getElementById('dial');if(D){D.style.removeProperty('--nn-charge');D.classList.remove('nn-full')}}

  /* ---------- ignite on press (visual only; the click proceeds untouched) ---------- */
  function onDown(e){lastInput=performance.now();
    const b=e.target.closest&&e.target.closest(IGN);if(!b)return;
    b.classList.remove('nn-ign');void b.offsetWidth;b.classList.add('nn-ign');
    clearTimeout(b._nnIgnT);b._nnIgnT=setTimeout(()=>b.classList.remove('nn-ign'),420);
  }

  /* ---------- idle flicker ---------- */
  const dark=()=>getComputedStyle(R).getPropertyValue('--nn-k').trim()==='1';
  function inView(el){const r=el.getBoundingClientRect();return r.width>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}
  function flickLoop(){
    flickT=setTimeout(()=>{
      if(active&&!document.hidden&&!RM()&&dark()&&performance.now()-lastInput>2500){
        const c=[...document.querySelectorAll(FLICK)].filter(el=>!el.closest('[inert],.sheet')&&!el.matches(':hover')&&inView(el));
        if(c.length){const el=c[Math.floor(Math.random()*c.length)];flash(el,'nn-flick',1200)}
      }
      if(active)flickLoop();
    },7000+Math.random()*9000);
  }

  /* ---------- scan for sliders / dial after renders ---------- */
  function scan(){document.querySelectorAll('.xs').forEach(xsAttach)}

  function activate(){
    if(active)return;active=true;
    if(!document.getElementById('nn-fonts')){const l=document.createElement('link');l.id='nn-fonts';l.rel='stylesheet';l.href=FONTS;document.head.appendChild(l)}
    xsMo=new MutationObserver(onXsMut);
    mo=new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1&&(n.matches('.xs')||n.querySelector('.xs'))){scan();return}});
    mo.observe(document.body,{childList:true,subtree:true});
    const T=document.getElementById('dialTicks');
    const m0=T&&/rotate\((-?[\d.]+)deg\)/.exec(T.style.transform||'');dState.last=m0?Math.round(parseFloat(m0[1])/15):0;
    if(T){tickMo=new MutationObserver(onTicks);tickMo.observe(T,{attributes:true,attributeFilter:['style']})}
    listen(document,'pointerdown',onDown,true);
    listen(document,'keydown',()=>{lastInput=performance.now()},true);
    listen(document,'visibilitychange',()=>{if(document.hidden){humStop();if(ac&&ac.state==='running')ac.suspend().catch(()=>{})}});
    scan();lastInput=performance.now();flickLoop();
  }
  function deactivate(){
    if(!active)return;active=false;
    mo&&mo.disconnect();xsMo&&xsMo.disconnect();tickMo&&tickMo.disconnect();mo=xsMo=tickMo=null;
    cleanups.splice(0).forEach(f=>f());clearTimeout(flickT);humStop();
    document.querySelectorAll('.nn-xs').forEach(xsDetach);
    document.querySelectorAll('.nn-ign,.nn-flick').forEach(el=>el.classList.remove('nn-ign','nn-flick'));
    dialReset();
    const l=document.getElementById('nn-fonts');l&&l.remove();
    if(ac){ac.close().catch(()=>{});ac=null}
  }
  const sync=()=>on()?activate():deactivate();
  new MutationObserver(sync).observe(R,{attributes:true,attributeFilter:['data-skin']});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync);else sync();
})();
