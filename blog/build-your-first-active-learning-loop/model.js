(function(root) {
  'use strict';
  const classes = ['access','billing','technical'];
  const tokens = text => text.toLowerCase().match(/[a-z]+/g) || [];
  class RNG {
    constructor(seed) { this.state=seed>>>0; }
    shuffle(input) {
      const a=[...input];
      for(let i=a.length-1;i>0;i--) {
        this.state=(Math.imul(1664525,this.state)+1013904223)>>>0;
        const j=Math.floor(this.state/4294967296*(i+1)); [a[i],a[j]]=[a[j],a[i]];
      }
      return a;
    }
  }
  class NaiveBayes {
    constructor(rows) {
      this.counts=classes.map(()=>new Map()); this.vocab=new Set(); this.totals=[0,0,0];
      for(const row of rows) for(const w of tokens(row.text)) {
        const i=classes.indexOf(row.label);this.counts[i].set(w,(this.counts[i].get(w)||0)+1);
        this.totals[i]++; this.vocab.add(w);
      }
      if(!this.vocab.size) throw new Error('No recognized words in the seed.');
    }
    probabilities(text) {
      const words=tokens(text).filter(w=>this.vocab.has(w));
      const scores=classes.map((_,i)=>words.reduce((s,w)=>s+Math.log(((this.counts[i].get(w)||0)+1)/(this.totals[i]+this.vocab.size)),0));
      const weights=scores.map(s=>Math.exp(s-Math.max(...scores))), total=weights.reduce((a,b)=>a+b,0);
      return weights.map(w=>w/total);
    }
  }
  const entropy=p=>-p.reduce((s,x)=>s+(x>0?x*Math.log2(x):0),0);
  function evaluate(model,rows) {
    const matrix=classes.map(()=>[0,0,0]);
    for(const row of rows) {
      const p=model.probabilities(row.text), pred=p.indexOf(Math.max(...p));
      matrix[classes.indexOf(row.label)][pred]++;
    }
    const per_class=classes.map((label,i)=>{
      const tp=matrix[i][i],total=matrix[i].reduce((a,b)=>a+b,0),fp=matrix.reduce((s,r)=>s+r[i],0)-tp;
      return {label,correct:tp,total,f1:(total+tp+fp)?2*tp/(total+tp+fp):0};
    });
    return {accuracy:per_class.reduce((s,r)=>s+r.correct,0)/rows.length,macro_f1:per_class.reduce((s,r)=>s+r.f1,0)/3,matrix,per_class,n:rows.length};
  }
  class Run {
    constructor(rows,strategy,seed,batch=3,maxRounds=6) {
      this.strategy=strategy;this.seed=seed;this.batch=batch;this.maxRounds=maxRounds;this.round=0;this.phase=0;this.closed=false;
      const train=rows.filter(r=>r.split==='train').sort((a,b)=>a.id<b.id?-1:1);
      this.oracle=new Map(train.map(r=>[r.id,r.label]));
      const shuffled=new RNG(seed).shuffle(train.map(r=>({id:r.id,text:r.text})));
      this.labeled=shuffled.slice(0,6).map(r=>({...r,label:this.oracle.get(r.id)}));
      this.pool=shuffled.slice(6).sort((a,b)=>a.id<b.id?-1:1);
      this.initialIds=this.labeled.map(r=>r.id);this.validation=rows.filter(r=>r.split==='validation');
      this.testRows=rows.filter(r=>r.split==='test');this.rng=new RNG(seed+101);
      this.fitWork=0;this.scoreWork=0;this.history=[];this.acquisitions=[];this.selected=[];this.fit();
    }
    fit() {
      this.model=new NaiveBayes(this.labeled);this.fitWork+=this.labeled.length;
      this.metrics=evaluate(this.model,this.validation);
      this.history.push({round:this.round,labels:this.labeled.length,macro_f1:this.metrics.macro_f1,accuracy:this.metrics.accuracy,fit_documents_cumulative:this.fitWork,score_documents_cumulative:this.scoreWork});
    }
    select() {
      if(this.closed||this.phase!==0||this.round>=this.maxRounds||!this.pool.length) return false;
      if(this.strategy==='entropy') {
        this.ranked=this.pool.map(r=>{const p=this.model.probabilities(r.text);return {...r,probabilities:p,entropy:entropy(p)};});
        this.ranked.sort((a,b)=>Number(b.entropy.toFixed(12))-Number(a.entropy.toFixed(12))||(a.id<b.id?-1:1));
        this.scoreWork+=this.pool.length;
      } else this.ranked=this.rng.shuffle(this.pool);
      this.selected=this.ranked.slice(0,this.batch).map(r=>({...r}));this.phase=1;return true;
    }
    reveal() {
      if(this.closed||this.phase!==1) return false;
      this.selected=this.selected.map(r=>({...r,label:this.oracle.get(r.id)}));this.phase=2;return true;
    }
    update() {
      if(this.closed||this.phase!==2) return false;
      const ids=new Set(this.selected.map(r=>r.id));
      this.labeled.push(...this.selected.map(({id,text,label})=>({id,text,label})));
      this.acquisitions.push(...this.selected.map(r=>({...r,round:this.round+1})));
      this.pool=this.pool.filter(r=>!ids.has(r.id));this.round++;this.phase=0;this.fit();return true;
    }
    finish() {
      if(this.closed||this.phase!==0) return false;
      this.closed=true;this.test=evaluate(this.model,this.testRows);return true;
    }
  }
  const api={classes,tokens,RNG,NaiveBayes,entropy,evaluate,Run};
  if(typeof module==='object'&&module.exports) module.exports=api; else root.ProjectModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
