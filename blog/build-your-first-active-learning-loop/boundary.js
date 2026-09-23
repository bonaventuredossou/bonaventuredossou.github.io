(function(root) {
  'use strict';
  // A controlled, noiseless threshold problem. Selection never receives truth.
  const TRUTH=.63, SIZE=4096, ROUNDS=6;
  class RNG {
    constructor(seed){this.state=seed>>>0;}
    next(){let t=this.state=(this.state+0x6D2B79F5)>>>0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}
  }
  function probability(x,lo,hi){return Math.max(0,Math.min(1,(x-lo)/(hi-lo)));}
  function entropy(p){return p<=0||p>=1?0:-p*Math.log2(p)-(1-p)*Math.log2(1-p);}
  function select(pool,lo,hi,strategy,rng){
    if(strategy==='random')return pool[Math.floor(rng.next()*pool.length)];
    let best=pool[0],score=-1;
    for(const k of pool){const h=entropy(probability(k/SIZE,lo,hi));if(h>score){best=k;score=h;}}
    return best;
  }
  function trajectory(strategy,seed=7,truth=TRUTH){
    let lo=0,hi=1;const rng=new RNG(seed),pool=Array.from({length:SIZE-1},(_,i)=>i+1);
    const states=[{round:0,lo,hi,width:1,query:null,label:null}];
    for(let round=1;round<=ROUNDS;round++){
      const selected=select(pool,lo,hi,strategy,rng),x=selected/SIZE;
      // Oracle lookup happens after selection. Its label updates the bounds.
      const label=x>=truth?1:0;
      if(label===0)lo=Math.max(lo,x);else hi=Math.min(hi,x);
      pool.splice(pool.indexOf(selected),1);
      states.push({round,lo,hi,width:hi-lo,query:x,label});
    }
    return states;
  }
  const uncertain=trajectory('entropy'),random=Array.from({length:100},(_,i)=>trajectory('random',i+1));
  const means=Array.from({length:ROUNDS+1},(_,i)=>random.reduce((s,r)=>s+r[i].width,0)/random.length);
  const api={TRUTH,SIZE,ROUNDS,RNG,probability,entropy,select,trajectory,uncertain,random,means};
  if(typeof module==='object'&&module.exports){module.exports=api;return;}
  root.BoundaryModel=api;
  const $=id=>document.getElementById(id);let round=0,finished=false;
  const pct=x=>(100*x).toFixed(2)+'%';
  function numberline(s,color){
    const x=v=>35+v*610;
    return `<svg viewBox="0 0 680 108" role="img" aria-label="Possible cutoff lies between ${s.lo.toFixed(4)} and ${s.hi.toFixed(4)}"><path d="M35 52H645" stroke="#d7e4d9" stroke-width="14"/><path d="M${x(s.lo)} 52H${x(s.hi)}" stroke="${color}" stroke-width="14"/><circle cx="${x(s.lo)}" cy="52" r="5" fill="#173d37"/><circle cx="${x(s.hi)}" cy="52" r="5" fill="#173d37"/>${s.query!==null?`<path d="M${x(s.query)} 18V37" stroke="#173d37" stroke-width="2"/><text x="${x(s.query)}" y="12" text-anchor="middle">latest query</text>`:''}<text x="35" y="92">0</text><text x="645" y="92" text-anchor="end">1</text></svg>`;
  }
  function render(){
    const seed=Number($('boundary-seed').value),a=uncertain[round],b=random[seed-1][round];
    $('boundary-round').textContent=round+' / '+ROUNDS;
    $('boundary-labels').textContent=2+round;
    $('boundary-width').textContent=pct(a.width);
    $('boundary-random-width').textContent=pct(means[round]);
    $('boundary-next').disabled=round===ROUNDS||finished;
    $('boundary-finish').disabled=finished;
    $('boundary-next').textContent=round===ROUNDS?'Six queries complete':'Ask for one more label';
    $('boundary-status').textContent=finished?`The hidden cutoff was ${TRUTH}. Both strategies used the same two endpoint labels and ${round} additional labels. Reset to explore again.`:round===0?'Both learners know the label at 0 and at 1. Every cutoff between them is still possible. Ask a question to reduce that interval.':`Query ${round}: uncertainty sampling asked at ${a.query.toFixed(4)} and received class ${a.label===0?'A':'B'}. The possible cutoff interval is now [${a.lo.toFixed(4)}, ${a.hi.toFixed(4)}].`;
    $('boundary-lines').innerHTML=`<section><h4>Uncertainty sampling</h4>${numberline(a,'#117c72')}<p>Possible cutoff: ${a.lo.toFixed(4)} to ${a.hi.toFixed(4)}</p></section><section><h4>One random run (seed ${seed})</h4>${numberline(b,'#a85139')}<p>Possible cutoff: ${b.lo.toFixed(4)} to ${b.hi.toFixed(4)}</p></section>`;
    const parts=['<title>Fraction of the input range where the cutoff remains unknown, lower is better</title>'];
    for(const v of [0,.25,.5,.75,1]){let y=245-v*200;parts.push(`<path d="M55 ${y}H680" stroke="#dce5de"/><text x="10" y="${y+4}">${Math.round(v*100)}%</text>`);}
    for(let i=0;i<=ROUNDS;i++)parts.push(`<text x="${55+i*103-4}" y="271">${i}</text>`);
    for(const [values,color,dash] of [[uncertain.map(s=>s.width),'#117c72',''],[means,'#a85139','stroke-dasharray="7 5"']]){
      const pts=values.slice(0,round+1).map((v,i)=>`${55+i*103},${245-v*200}`).join(' ');
      parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3" ${dash}/>`);
      values.slice(0,round+1).forEach((v,i)=>parts.push(`<circle cx="${55+i*103}" cy="${245-v*200}" r="4" fill="${color}"/>`));
    }
    parts.push('<text x="55" y="22">Remaining unknown region ↓</text><text x="395" y="305">Additional labels per learner →</text>');
    $('boundary-chart').innerHTML=parts.join('');
    $('boundary-table').innerHTML=uncertain.slice(0,round+1).map((s,i)=>`<tr><td>${i}</td><td>${pct(s.width)}</td><td>${pct(means[i])}</td></tr>`).join('');
    $('boundary-reading').textContent=round===0?'The curves start together. Follow how much each new label rules out.':`After ${round} additional labels, uncertainty leaves ${pct(a.width)} of the range unresolved. Across seeds 1–100, random leaves ${pct(means[round])} on average. A random query outside its current interval adds no new boundary information.`;
    $('boundary-reveal').hidden=!finished;
    if(finished){
      const error=Math.abs((a.lo+a.hi)/2-TRUTH);
      const meanError=random.reduce((s,r)=>s+Math.abs((r[round].lo+r[round].hi)/2-TRUTH),0)/100;
      $('boundary-reveal').textContent=`Using each interval midpoint as the classifier cutoff, exact error under a uniform input distribution is ${pct(error)} for uncertainty and ${pct(meanError)} on average for random. This is calculated for the constructed threshold problem, not measured on support tickets. Interval width measures remaining uncertainty; it is not the error rate.`;
    }
  }
  $('boundary-next').addEventListener('click',()=>{if(round<ROUNDS&&!finished){round++;render();}});
  $('boundary-reset').addEventListener('click',()=>{round=0;finished=false;render();});
  $('boundary-finish').addEventListener('click',()=>{finished=true;render();});
  $('boundary-seed').addEventListener('change',render);
  $('boundary-start').addEventListener('click',()=>{round=0;finished=false;render();$('intuition-lab').scrollIntoView({block:'start'});$('boundary-heading').focus({preventScroll:true});});
  document.querySelectorAll('[data-boundary]').forEach(el=>el.disabled=false);
  render();
})(typeof globalThis!=='undefined'?globalThis:this);
