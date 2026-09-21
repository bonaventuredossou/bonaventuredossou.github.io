/* Deterministic teaching examples. No model is trained and no hardware is benchmarked. */
"use strict";
const TutorialModel = (() => {
  const cases = {
    split: { probabilities: [.1,.9,.1,.9,.1,.9,.1,.9,.1,.9], label: 1 },
    ambiguous: { probabilities: Array(10).fill(.5), label: 1 },
    confident: { probabilities: Array(10).fill(.95), label: 0 }
  };
  function entropy(p) {
    if (p < 0 || p > 1 || !Number.isFinite(p)) throw new Error("Probability outside [0, 1]");
    return p === 0 || p === 1 ? 0 : -p*Math.log2(p)-(1-p)*Math.log2(1-p);
  }
  function uncertainty(values) {
    if (!values.length) return null;
    const mean = values.reduce((a,b)=>a+b,0)/values.length;
    const total = entropy(mean), within = values.reduce((a,b)=>a+entropy(b),0)/values.length;
    return { mean, total, within, between: Math.max(0,total-within) };
  }
  const defaults = {pool:4000,batch:100,passes:10,epochs:3,minutes:2};
  function roundCost(c,r) {
    if (!Number.isInteger(r) || r<1 || r>Math.floor(c.pool/c.batch)) throw new Error("Invalid acquisition round");
    const pool = c.pool-(r-1)*c.batch;
    const scoring = pool*c.passes*.02;
    const full = (500+r*c.batch)*c.epochs*.1;
    const continual = c.batch*c.epochs*.1;
    const evaluation = 500*.02;
    return { pool, scoring, full, continual, evaluation, annotation:c.batch*c.minutes,
      fullTotal:scoring+full+evaluation, continualTotal:scoring+continual+evaluation };
  }
  function ledger(c,rounds) {
    if(!Number.isInteger(rounds)||rounds<0||rounds>Math.min(6,Math.floor(c.pool/c.batch)))throw new Error("Invalid ledger length");
    const rows=Array.from({length:rounds},(_,i)=>roundCost(c,i+1));
    const sum=key=>rows.reduce((a,b)=>a+b[key],0);
    return {rows,scoring:sum('scoring'),full:sum('full'),continual:sum('continual'),evaluation:sum('evaluation'),annotation:sum('annotation'),fullTotal:sum('fullTotal'),continualTotal:sum('continualTotal')};
  }
  return {cases,entropy,uncertainty,defaults,roundCost,ledger};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=TutorialModel;
if(typeof document!=="undefined")(()=>{
  const M=TutorialModel,$=id=>document.getElementById(id),set=(id,text)=>$(id).textContent=text;
  const decimal=(n,d=2)=>n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
  let draws=0,revealed=false,rounds=0;
  const descriptions={
    split:"The passes alternate between 10% and 90% probability of class 1. The average alone conceals their disagreement.",
    ambiguous:"Every pass assigns 50% to class 1. More passes repeat the same indecision.",
    confident:"Every pass assigns 95% to class 1. Inspect the reference label before deciding whether agreement means correctness."
  };
  function renderUncertainty(){
    const key=$('uncertainty-case').value,example=M.cases[key],values=example.probabilities.slice(0,draws),u=M.uncertainty(values);
    set('draw-count',`${draws} / 10`);set('uncertainty-context',descriptions[key]);
    const list=$('probability-passes');list.replaceChildren();
    if(!draws){const p=document.createElement('p');p.textContent="No passes yet. Add a pass to inspect its probability.";list.append(p);}
    values.forEach((p,i)=>{const row=document.createElement('div');row.className='probability-row';
      const label=document.createElement('span');label.textContent=`Pass ${i+1}`;
      const track=document.createElement('span');track.className='probability-track';track.setAttribute('aria-hidden','true');
      const fill=document.createElement('i');fill.style.width=`${p*100}%`;track.append(fill);
      const value=document.createElement('strong');value.textContent=`${Math.round(p*100)}%`;row.append(label,track,value);list.append(row);
    });
    set('probability-mean',u?`${decimal(u.mean*100,1)}%`:'Waiting');
    for(const [id,key] of [['entropy-total','total'],['entropy-within','within'],['entropy-between','between']])set(id,u?`${decimal(u[key],3)} bits`:'Waiting');
    set('uncertainty-reading',!u?'Begin with one pass, then add another. All scores are estimates from the passes shown.':draws===1?'With one pass, the disagreement estimate is zero by construction. You have not established that model uncertainty is absent.':key==='split'?`Predictive entropy is ${decimal(u.total,3)} bits, while the average within-pass entropy is ${decimal(u.within,3)} bits. Their difference reflects disagreement between these hypothetical model predictions.`:key==='ambiguous'?'Predictive entropy is high, but the passes do not disagree. These examples show why entropy alone cannot identify the reason a prediction is uncertain.':'Low predictive entropy and zero disagreement can coexist with an incorrect prediction. A narrow approximate posterior can miss a shared blind spot.');
    $('add-pass').disabled=draws===10;$('finish-passes').disabled=draws===10;$('reveal-label').disabled=draws===0||revealed;
    $('reference-result').hidden=!revealed;
    if(revealed){const prediction=u.mean>.5?1:u.mean<.5?0:null;
      set('reference-result',`Constructed reference label: ${example.label}. ${prediction===null?'The mean prediction is tied at 50%; no unique class is selected.':`The mean prediction favors class ${prediction}, which is ${prediction===example.label?'correct':'incorrect'} for this example.`} One labeled example cannot establish population accuracy.`);}
  }
  function resetUncertainty(){draws=0;revealed=false;renderUncertainty();}
  $('uncertainty-case').addEventListener('change',resetUncertainty);
  $('add-pass').addEventListener('click',()=>{draws=Math.min(10,draws+1);renderUncertainty();});
  $('finish-passes').addEventListener('click',()=>{draws=10;renderUncertainty();});
  $('reset-uncertainty').addEventListener('click',resetUncertainty);
  $('reveal-label').addEventListener('click',()=>{revealed=true;renderUncertainty();});
  const config=()=>Object.fromEntries(Object.keys(M.defaults).map(k=>[k,Number($(`compute-${k}`).value)]));
  function renderCompute(){
    const c=config(),s=M.ledger(c,rounds),limit=Math.min(6,Math.floor(c.pool/c.batch));
    set('compute-round',`${rounds} / ${limit}`);set('compute-labels',(rounds*c.batch).toLocaleString('en-US'));
    set('compute-human',`${decimal(s.annotation/60)} hours`);
    set('compute-full-total',`${decimal(s.fullTotal/60)} min`);set('compute-cf-total',`${decimal(s.continualTotal/60)} min`);
    const scale=Math.max(s.fullTotal,s.continualTotal,1);
    for(const [prefix,training] of [['full',s.full],['cf',s.continual]]){
      for(const [part,value] of [['score',s.scoring],['train',training],['eval',s.evaluation]])$(`${prefix}-${part}-bar`).style.width=`${value/scale*100}%`;
      set(`${prefix}-cost-breakdown`,`Scoring ${decimal(s.scoring/60)} min + training ${decimal(training/60)} min + evaluation ${decimal(s.evaluation/60)} min.`);
    }
    const body=$('compute-ledger');body.replaceChildren();
    s.rows.forEach((r,i)=>{const tr=document.createElement('tr');[i+1,r.pool,decimal(r.scoring/60),decimal(r.full/60),decimal(r.continual/60),decimal(r.evaluation/60)].forEach((v,j)=>{const td=document.createElement(j===0?'th':'td');if(!j)td.scope='row';td.textContent=v;tr.append(td);});body.append(tr);});
    set('compute-insight',rounds?`Continual updates save ${decimal((s.fullTotal-s.continualTotal)/60)} modeled GPU minutes (${decimal((s.fullTotal-s.continualTotal)/s.fullTotal*100,1)}% of the full-update total). Pool scoring accounts for ${decimal(s.scoring/s.fullTotal*100,1)}% of the full-update total. The learning quality of either strategy has not been measured here.`:'No rounds charged yet. Advance one round to see where the work goes. Both strategies acquire the same number of examples.');
    set('compute-next',rounds<limit?`Next round: score ${(c.pool-rounds*c.batch).toLocaleString('en-US')} remaining candidates with ${c.passes} passes each, annotate ${c.batch}, then update and evaluate.`:rounds*c.batch===c.pool?'The candidate pool is exhausted.':'The six-round teaching horizon is complete. This is not a performance-based stopping decision.');
    $('compute-advance').disabled=rounds>=limit;$('compute-finish').disabled=rounds>=limit;
  }
  Object.keys(M.defaults).forEach(key=>$(`compute-${key}`).addEventListener('change',()=>{rounds=0;renderCompute();}));
  $('compute-advance').addEventListener('click',()=>{rounds=Math.min(rounds+1,6,Math.floor(config().pool/config().batch));renderCompute();});
  $('compute-finish').addEventListener('click',()=>{rounds=Math.min(6,Math.floor(config().pool/config().batch));renderCompute();});
  $('compute-reset').addEventListener('click',()=>{rounds=0;renderCompute();});
  $('compute-defaults').addEventListener('click',()=>{for(const [key,value] of Object.entries(M.defaults))$(`compute-${key}`).value=value;rounds=0;renderCompute();});
  const lessons={plateau:['delayed','cf','600','plateau'],group:['group','cf','600','plateau'],budget:['group','fa','300','budget']};
  const lessonTitles={plateau:'A misleading plateau',group:'One group left behind',budget:'A limited resource budget'};
  let activeLesson=null,labState=null,loadingLesson=false,nextAction=null;
  const scrollToGuide=()=>{
    $('active-lesson-title').focus({preventScroll:true});
    $('active-lesson').scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  };
  function renderGuide(){
    $('active-lesson').hidden=!activeLesson;
    document.querySelectorAll('[data-lesson]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.lesson===activeLesson)));
    if(!activeLesson||!labState)return;
    const s=labState,d=StoppingModel.reading(s.scenario,s.round);
    set('active-lesson-title',lessonTitles[activeLesson]);
    set('active-lesson-reading',`Round ${s.round} · ${200+s.round*50} labels · overall error ${d.overall.toFixed(1)}% · group B error ${d.b.toFixed(1)}% · ${StoppingModel.spent(s.mode,s.round)} / ${s.budget} credits spent.`);
    let step,instruction,label;
    if(s.revealed){
      step='Tutorial complete / Compare the outcome';
      instruction=$('decision-summary').textContent+' '+$('hindsight-summary').textContent;
      label='View the revealed comparison';nextAction='comparison';
    }else if(s.phase==='stopped'){
      step='Step 3 of 3 / Reveal and compare';
      instruction=`You stopped at round ${s.round}. ${s.reason}. Your decision is locked. Reveal the affordable continuation and compare the four stopping rules.`;
      label='Reveal the outcome';nextAction='reveal';
    }else if(activeLesson==='plateau'&&s.round<4){
      step='Step 1 of 3 / Acquire four batches';
      instruction=`Acquire one batch of 50 labels at a time. ${s.round} of 4 batches completed. Watch the error reductions above; the next rounds stay hidden until you stop.`;
      label=`Acquire batch ${s.round+1} of 4`;nextAction='acquire';
    }else if(activeLesson==='plateau'){
      step='Step 2 of 3 / Make your stopping decision';
      instruction=$('rule-reading').textContent+' For this walkthrough, stop here and then inspect what the decision leaves unseen. You can also keep exploring with the regular lab controls.';
      label='Stop here';nextAction='stop-now';
    }else{
      step='Steps 1–2 of 3 / Run and inspect';
      instruction=activeLesson==='group'?'Run the recent-gain rule. Then compare overall error with group B error: does a small recent improvement mean both groups are well served?':'Run until the next complete batch is unaffordable. Then inspect the remaining budget and group errors. A resource limit is not a performance target.';
      label=activeLesson==='group'?'Run the recent-gain rule':'Run the budget rule';nextAction='run-rule';
    }
    set('active-lesson-step',step);set('active-lesson-instruction',instruction);set('lesson-next',label);
  }
  document.addEventListener('stopping:change',event=>{labState=event.detail;if(!loadingLesson)renderGuide();});
  function loadLesson(key){
    activeLesson=key;loadingLesson=true;
    const values=lessons[key];
    ['scenario','update-mode','budget','rule'].forEach((id,i)=>{$(id).value=values[i];$(id).dispatchEvent(new Event('change',{bubbles:true}));});
    loadingLesson=false;renderGuide();
    set('lesson-status',`${lessonTitles[key]} is open in the stopping lab. Follow the highlighted tutorial panel.`);
    scrollToGuide();
  }
  document.querySelectorAll('[data-lesson]').forEach(button=>button.addEventListener('click',()=>loadLesson(button.dataset.lesson)));
  $('lesson-next').addEventListener('click',()=>{
    if(!activeLesson||!nextAction)return;
    if(nextAction==='comparison')$('reveal-panel').scrollIntoView({block:'start',behavior:'auto'});
    else $(nextAction).click();
  });
  $('restart-lesson').addEventListener('click',()=>{if(activeLesson)loadLesson(activeLesson);});
  $('exit-lesson').addEventListener('click',()=>{
    const previous=activeLesson;activeLesson=null;renderGuide();
    set('lesson-status','Tutorial closed. You can continue exploring the lab or load another tutorial.');
    document.querySelector(`[data-lesson="${previous}"]`)?.focus();
  });
  ['scenario','update-mode','budget','rule'].forEach(id=>$(id).addEventListener('change',()=>{
    if(loadingLesson||!activeLesson)return;
    activeLesson=null;renderGuide();set('lesson-status','Tutorial closed because the lab settings changed. Explore freely, or load a tutorial to start again.');
  }));
  $('load-value-example').addEventListener('click',()=>{
    for(const [id,v] of Object.entries({'future-count':10000,'error-cost':2,'expected-gain':.5,'batch-price':200})){$(id).value=v;$(id).dispatchEvent(new Event('input',{bubbles:true}));}
    set('value-example-status','Loaded the text-routing example: estimated benefit 100 credits, cost 200, net value −100. Now lower cost to 50 and compare.');
  });
  document.querySelectorAll('.tutorial-lab button,.tutorial-lab select,.active-lesson button,[data-lesson],#load-value-example').forEach(el=>{el.disabled=false;});
  renderUncertainty();renderCompute();
})();
