/* ============================================================
 *  BioinfoGPT — client-side bioinformatics toolkit
 *  Pure functions (no DOM), so they're unit-testable in Node.
 *  Includes original tools + new features for everyone: primers,
 *  PCR, MSA, dot-plot, BLAST-like, file parsing.
 * ============================================================ */
window.BIO = (() => {
  const DNA_RE = /^[ACGTUNRYSWKMBDHV]+$/i;
  const PROTEIN_RE = /^[ACDEFGHIKLMNPQRSTVWY\*X]+$/i;
  const STRIP = /[\s\d_\-]/g;

  const CODON_TABLE = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L",
    TCT: "S", TCC: "S", TCA: "S", TCG: "S",
    TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
    TGT: "C", TGC: "C", TGA: "*", TGG: "W",
    CTT: "L", CTC: "L", CTA: "L", CTG: "L",
    CCT: "P", CCC: "P", CCA: "P", CCG: "P",
    CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
    CGT: "R", CGC: "R", CGA: "R", CGG: "R",
    ATT: "I", ATC: "I", ATA: "I", ATG: "M",
    ACT: "T", ACC: "T", ACA: "T", ACG: "T",
    AAT: "N", AAC: "N", AAA: "K", AAG: "K",
    AGT: "S", AGC: "S", AGA: "R", AGG: "R",
    GTT: "V", GTC: "V", GTA: "V", GTG: "V",
    GCT: "A", GCC: "A", GCA: "A", GCG: "A",
    GAT: "D", GAC: "D", GAA: "E", GAG: "E",
    GGT: "G", GGC: "G", GGA: "G", GGG: "G",
  };

  const COMPLEMENT = {
    A: "T", T: "A", G: "C", C: "G", U: "A", N: "N",
    R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K",
    B: "V", V: "B", D: "H", H: "D",
  };

  function clean(seq) {
    return String(seq || "")
      .split("\n")
      .filter((l) => !l.trim().startsWith(">"))
      .join("")
      .replace(STRIP, "")
      .toUpperCase();
  }

  function detectType(seq) {
    const s = clean(seq);
    if (!s) return "empty";
    if (/^[ACGTN]+$/i.test(s) || DNA_RE.test(s)) {
      if (/U/.test(s) && !/T/.test(s)) return "RNA";
      if (/U/.test(s) && /T/.test(s)) return "DNA (contains U — check input)";
      return "DNA";
    }
    if (PROTEIN_RE.test(s)) return "protein";
    return "ambiguous";
  }

  function stats(seq) {
    const s = clean(seq);
    const counts = {};
    for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
    const gc = s ? ((counts.G || 0) + (counts.C || 0)) / s.length * 100 : 0;
    const at = s ? ((counts.A || 0) + (counts.T || 0) + (counts.U || 0)) / s.length * 100 : 0;
    let mw = 0;
    for (const ch of s) {
      if (DNA_RE.test(ch)) mw += 330;
      else if (ch === "U") mw += 323;
      else mw += 110;
    }
    mw -= (s.length - 1) * 18.015;
    const tm = meltingTemp(s, counts);
    return { length: s.length, counts, gc, at, mw: Math.max(0, mw), tm, purines: (counts.A || 0) + (counts.G || 0), pyrimidines: (counts.C || 0) + (counts.T || 0) + (counts.U || 0) };
  }

  function meltingTemp(s, counts) {
    if (!s) return null;
    if (s.length <= 14) {
      return 2 * ((counts.A || 0) + (counts.T || 0) + (counts.U || 0)) + 4 * ((counts.G || 0) + (counts.C || 0));
    }
    const gc = ((counts.G || 0) + (counts.C || 0)) / s.length * 100;
    return 64.9 + 41 * (gc - 16.4) / s.length;
  }

  function reverseComplement(seq) {
    const s = clean(seq);
    const rna = /U/.test(s) && !/T/.test(s);
    const map = rna ? { ...COMPLEMENT, A: "U" } : COMPLEMENT;
    return [...s].reverse().map((ch) => map[ch] || ch).join("");
  }

  function reverse(seq) { return clean(seq).split("").reverse().join(""); }

  function translate(seq, frame = 0) {
    const s = clean(seq);
    const start = ((frame % 3) + 3) % 3;
    const codons = [];
    const aa = [];
    for (let i = start; i + 2 < s.length; i += 3) {
      const codon = s.slice(i, i + 3);
      codons.push(codon);
      aa.push(CODON_TABLE[codon] ?? "X");
    }
    return { codons, aa, sequence: aa.join(""), frame: start, stopCount: aa.filter((a) => a === "*").length };
  }

  const VALID = { DNA: "ACGTN", RNA: "ACGUN", protein: "ACDEFGHIKLMNPQRSTVWYX*" };
  const IUPAC_EXTRA = "RYSWKMBDHV";

  function checkAlphabet(seq) {
    const s = clean(seq);
    const type = detectType(s);
    if (type === "empty") return { type, invalid: [], valid: true };
    const allowed = type === "protein" ? VALID.protein : type === "ambiguous" ? "ACGTUNRYSWKMBDHVACDEFGHIKLMNPQRSTVWYX*" : VALID[type] + IUPAC_EXTRA;
    const invalid = [];
    for (let i = 0; i < s.length; i++) if (!allowed.includes(s[i])) invalid.push({ ch: s[i], pos: i + 1 });
    return { type, invalid, valid: invalid.length === 0 };
  }

  function randomDNA(n) { const a="ACGT"; return Array.from({length:n},()=>a[Math.floor(Math.random()*4)]).join(""); }
  function randomRNA(n) { const a="ACGU"; return Array.from({length:n},()=>a[Math.floor(Math.random()*4)]).join(""); }
  function randomProtein(n) { const a="ACDEFGHIKLMNPQRSTVWY"; return Array.from({length:n},()=>a[Math.floor(Math.random()*20)]).join(""); }

  function gcWindow(seq, win=100, step=50) {
    const s=clean(seq); const out=[];
    for (let i=0;i+win<=s.length;i+=step){ const w=s.slice(i,i+win); const g=(w.match(/[GC]/g)||[]).length; out.push({start:i,gc:g/win*100}); }
    return out;
  }

  /* Feature 2 tools */
  function _rc(str){ const out=[]; for(let i=str.length-1;i>=0;i--){ const ch=str[i]; out.push(COMPLEMENT[ch]||ch);} return out.join(""); }

  function findORFs(seq,minAA=30){
    let s=clean(seq).replace(/U/g,"T"); const L=s.length; const orfs=[]; const rc=_rc(s);
    const strands=[{strand:1,seq:s},{strand:-1,seq:rc}];
    for(const {strand,seq:qry} of strands){ const QL=qry.length;
      for(let f=0;f<3;f++){ for(let i=f;i+2<QL;i+=3){ if(qry.slice(i,i+3)!=="ATG")continue;
        let stop=-1; for(let j=i+3;j+2<QL;j+=3){ const c=qry.slice(j,j+3); if(c==="TAA"||c==="TAG"||c==="TGA"){stop=j;break;}}
        if(stop!==-1){ const cc=(stop-i)/3; if(cc<minAA)continue; const nt=qry.slice(i,stop+3); let prot=""; for(let k=i;k<stop;k+=3) prot+=CODON_TABLE[qry.slice(k,k+3)]||"X";
          let start,end; if(strand===1){start=i+1;end=stop+3;} else {const er=stop+3; start=L-er+1; end=L-i;}
          orfs.push({strand,frame:f+1,start,end,length:prot.length,nt,protein:prot,complete:true});
        } else { const rem=QL-i; const cc=Math.floor(rem/3); if(cc<minAA)continue; const nt=qry.slice(i,i+cc*3); let prot=""; for(let k=i;k<i+cc*3;k+=3) prot+=CODON_TABLE[qry.slice(k,k+3)]||"X";
          let start,end; if(strand===1){start=i+1;end=i+cc*3;} else {const er=i+cc*3; start=L-er+1; end=L-i;}
          orfs.push({strand,frame:f+1,start,end,length:prot.length,nt,protein:prot,complete:false});
        }}}}
    orfs.sort((a,b)=>b.length-a.length||a.start-b.start); return orfs;
  }

  function sixFrame(seq){ const s=clean(seq); const rc=reverseComplement(s); const out=[]; const lf=["+1","+2","+3"], lr=["-1","-2","-3"]; for(let f=0;f<3;f++){ const tr=translate(s,f); out.push({...tr,label:lf[f]});} for(let f=0;f<3;f++){ const tr=translate(rc,f); out.push({...tr,label:lr[f]});} return out; }

  const IUPAC_MAP={A:"A",C:"C",G:"G",T:"T",U:"T",R:"[AG]",Y:"[CT]",S:"[GC]",W:"[AT]",K:"[GT]",M:"[AC]",B:"[CGT]",D:"[AGT]",H:"[ACT]",V:"[ACG]",N:"[ACGT]"};
  function iupacToRegex(pattern){ const p=String(pattern||"").replace(/[\s\d_\-]/g,"").toUpperCase(); if(!p)return null; let rs=""; for(const ch of p){ const m=IUPAC_MAP[ch]; if(!m)return null; rs+=m;} try{return new RegExp(rs,"g");}catch{return null;} }
  function findMotif(seq,pattern){
    const s=clean(seq).replace(/U/g,"T"); const pc=String(pattern||"").replace(/[\s\d_\-]/g,"").toUpperCase(); if(!pc)return {error:"Empty motif pattern",hits:[]};
    const baseRe=iupacToRegex(pc); if(!baseRe)return {error:`Invalid IUPAC pattern: ${pattern}`,hits:[]}; const pl=pc.length; const hits=[]; const fRe=new RegExp(baseRe.source,"g");
    for(let i=0;i+pl<=s.length;i++){ fRe.lastIndex=i; const m=fRe.exec(s); if(m&&m.index===i) hits.push({strand:1,start:i+1,match:m[0]}); }
    const rc=_rc(s); const rRe=new RegExp(baseRe.source,"g"); for(let i=0;i+pl<=rc.length;i++){ rRe.lastIndex=i; const m=rRe.exec(rc); if(m&&m.index===i){ const sf=s.length-i-pl+1; hits.push({strand:-1,start:sf,match:m[0]});} }
    return {hits,count:hits.length};
  }

  const ENZYMES={ EcoRI:"G^AATTC", BamHI:"G^GATCC", HindIII:"A^AGCTT", NotI:"GC^GGCCGC", XhoI:"C^TCGAG", SalI:"G^TCGAC", PstI:"CTGCA^G", SmaI:"CCC^GGG", KpnI:"GGTAC^C", SacI:"GAGCT^C", XbaI:"T^CTAGA", SpeI:"A^CTAGT", NcoI:"C^CATGG", NdeI:"CA^TATG", EcoRV:"GAT^ATC", HaeIII:"GG^CC", AluI:"AG^CT", TaqI:"T^CGA", BglII:"A^GATCT", ApaI:"GGGCC^C", };
  function restrictionMap(seq,names=null){
    let s=clean(seq).replace(/U/g,"T"); const L=s.length; const allNames=names&&names.length?names:Object.keys(ENZYMES); const enzymes=[]; const combined=new Set();
    for(const name of allNames){ const pat=ENZYMES[name]; if(!pat)continue; const ci=pat.indexOf("^"); if(ci===-1)continue; const site=pat.replace("^","").toUpperCase(); const off=ci; const cuts=[]; let idx=0; while(true){ const pos=s.indexOf(site,idx); if(pos===-1)break; const cp=pos+off+1; if(cp>=1&&cp<=L){cuts.push(cp); combined.add(cp);} idx=pos+1;} enzymes.push({name,site,pattern:pat,cuts:cuts.sort((a,b)=>a-b),count:cuts.length});}
    enzymes.sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
    const sorted=[...combined].sort((a,b)=>a-b);
    const recalc=(()=>{ const cs=[...combined].sort((a,b)=>a-b); if(cs.length===0)return [L]; const frags=[]; let last=1; for(const cut of cs){ const sz=cut-last; if(sz>0)frags.push(sz); last=cut;} const tail=L-last+1; if(tail>0)frags.push(tail); if(frags.length===0)frags.push(L); return frags;})();
    return {enzymes,cutCount:sorted.length,fragments:recalc,cuts:sorted};
  }

  const AA_MASS={A:89.0932,R:174.2017,N:132.1184,D:133.1027,C:121.159,E:147.1299,Q:146.1451,G:75.0666,H:155.1552,I:131.1736,L:131.1736,K:146.1882,M:149.2124,F:165.19,P:115.131,S:105.093,T:119.1197,W:204.2262,Y:181.1894,V:117.1469,};
  const KD={I:4.5,V:4.2,L:3.8,F:2.8,C:2.5,M:1.9,A:1.8,G:-0.4,T:-0.7,S:-0.8,W:-0.9,Y:-1.3,P:-1.6,H:-3.2,E:-3.5,Q:-3.5,D:-3.5,N:-3.5,K:-3.9,R:-4.5,};
  function chargeAtPH(counts,pH){ const pow=(a,b)=>Math.pow(a,b); let charge=0; charge+=1.0/(1.0+pow(10,pH-8.2)); charge+=-1.0/(1.0+pow(10,3.65-pH)); const get=(aa)=>counts[aa]||0; charge+=get("D")*(-1.0/(1.0+pow(10,3.9-pH))); charge+=get("E")*(-1.0/(1.0+pow(10,4.07-pH))); charge+=get("C")*(-1.0/(1.0+pow(10,8.18-pH))); charge+=get("Y")*(-1.0/(1.0+pow(10,10.46-pH))); charge+=get("H")*(1.0/(1.0+pow(10,pH-6.04))); charge+=get("K")*(1.0/(1.0+pow(10,pH-10.54))); charge+=get("R")*(1.0/(1.0+pow(10,pH-12.48))); return charge; }
  function isoelectricPoint(counts){ let lo=0,hi=14; for(let i=0;i<100;i++){ const mid=(lo+hi)/2; const c=chargeAtPH(counts,mid); if(c>0)lo=mid; else hi=mid;} return (lo+hi)/2; }
  function proteinProperties(seq){
    let s=clean(seq).replace(/\*/g,"").toUpperCase(); s=s.split("").filter((ch)=>/[ACDEFGHIKLMNPQRSTVWY]/.test(ch)).join(""); const len=s.length;
    if(len===0)return {length:0,mw:0,pI:0,gravy:0,aliphaticIndex:0,extinction:0,a280:0,negative:0,positive:0,netCharge7:0,counts:{}};
    const counts={}; for(const ch of s) counts[ch]=(counts[ch]||0)+1; let sum=0; for(const ch of s) sum+=AA_MASS[ch]||110; const mw=Math.max(0,sum-(len-1)*18.015);
    let gsum=0; for(const ch of s) gsum+=KD[ch]!==undefined?KD[ch]:0; const gravy=gsum/len;
    const aCount=counts.A||0,vCount=counts.V||0,iCount=counts.I||0,lCount=counts.L||0; const aliphaticIndex=(aCount+2.9*vCount+3.9*(iCount+lCount))/len*100;
    const wCount=counts.W||0,yCount=counts.Y||0,cCount=counts.C||0; const extinction=wCount*5500+yCount*1490+cCount*125;
    const negative=(counts.D||0)+(counts.E||0); const positive=(counts.R||0)+(counts.K||0); const netCharge7=chargeAtPH(counts,7.0); const pI=isoelectricPoint(counts);
    return {length:len,mw,pI,gravy,aliphaticIndex,extinction,a280:extinction,negative,positive,netCharge7,counts};
  }

  function codonUsage(seq,frame=0){
    const s=clean(seq).replace(/U/g,"T"); const tr=translate(s,frame); const codons=tr.codons; const usage={}; let total=0; for(const cod of codons){ if(!cod||cod.length!==3)continue; usage[cod]=(usage[cod]||0)+1; total++; }
    const byAA={}; const aaTotals={}; for(const cod in usage){ const aa=CODON_TABLE[cod]||"X"; aaTotals[aa]=(aaTotals[aa]||0)+usage[cod]; }
    for(const cod in usage){ const aa=CODON_TABLE[cod]||"X"; if(!byAA[aa])byAA[aa]=[]; const cnt=usage[cod]; const tot=aaTotals[aa]||1; byAA[aa].push({codon:cod,count:cnt,fraction:cnt/tot}); }
    for(const aa in byAA) byAA[aa].sort((a,b)=>b.count-a.count||a.codon.localeCompare(b.codon));
    return {usage,total,byAA};
  }

  function parseFasta(text){
    const lines=String(text||"").split(/\r?\n/); const records=[]; let cur=null;
    for(const raw of lines){ const line=raw.trim(); if(!line)continue; if(line.startsWith(">")){ if(cur)records.push(cur); const header=line.slice(1).trim(); const fs=header.search(/\s/); let id,desc; if(fs===-1){id=header;desc="";} else {id=header.slice(0,fs); desc=header.slice(fs+1).trim();} cur={id,desc,seq:""}; } else { if(!cur) cur={id:"",desc:"",seq:""}; const cleaned=line.replace(/[\s\d_\-]/g,"").toUpperCase(); cur.seq+=cleaned; } }
    if(cur)records.push(cur); return records;
  }

  function pairwiseIdentity(a,b){
    const sa=clean(a), sb=clean(b); const compared=Math.min(sa.length,sb.length); let matches=0; for(let i=0;i<compared;i++) if(sa[i]===sb[i])matches++; const identity=compared===0?0:(matches/compared)*100; const lengthMismatch=sa.length!==sb.length; return {identity,matches,compared,lengthMismatch};
  }

  /* ---------- New: Primer design ---------- */
  function _tm(seq){
    const s=clean(seq); const c={}; for(const ch of s) c[ch]=(c[ch]||0)+1;
    if(s.length<=14) return 2*((c.A||0)+(c.T||0))+4*((c.G||0)+(c.C||0));
    const gc=((c.G||0)+(c.C||0))/s.length*100; return 64.9+41*(gc-16.4)/s.length;
  }
  function designPrimers(seq, opts={}){
    const s=clean(seq).replace(/U/g,"T");
    const minLen=opts.minLen||18, maxLen=opts.maxLen||24, minTm=opts.minTm||55, maxTm=opts.maxTm||65, minGC=opts.minGC||40, maxGC=opts.maxGC||60;
    const primers=[];
    for(let len=minLen; len<=maxLen; len++){
      for(let i=0;i+len<=s.length;i++){
        const pr=s.slice(i,i+len);
        const gc=((pr.match(/[GC]/g)||[]).length)/len*100;
        if(gc<minGC||gc>maxGC)continue;
        const tm=_tm(pr);
        if(tm<minTm||tm>maxTm)continue;
        // simple hairpin check: no 4mer self-complement
        const rc=reverseComplement(pr);
        let selfComp=false;
        for(let k=0;k+4<=len;k++){ if(rc.includes(pr.slice(k,k+4))) { selfComp=true; break; } }
        if(selfComp)continue;
        primers.push({seq:pr,start:i+1,end:i+len, length:len, gc:gc.toFixed(1), tm:tm.toFixed(1)});
        if(primers.length>=50) break;
      }
      if(primers.length>=50) break;
    }
    // sort by closeness to ideal Tm 60 and GC 50
    primers.sort((a,b)=> Math.abs(a.tm-60)-Math.abs(b.tm-60) + Math.abs(a.gc-50)-Math.abs(b.gc-50));
    return primers.slice(0,20);
  }

  function inSilicoPCR(seq, fwd, rev){
    const s=clean(seq).replace(/U/g,"T");
    const f=clean(fwd).replace(/U/g,"T");
    const r=clean(rev).replace(/U/g,"T");
    const rRC=reverseComplement(r);
    // Find fwd binding
    const fIdx=s.indexOf(f);
    const rIdx=s.indexOf(rRC);
    if(fIdx===-1||rIdx===-1) return {found:false, msg:"Primers not found"};
    let start=Math.min(fIdx,rIdx), end=Math.max(fIdx+f.length, rIdx+rRC.length);
    if(start>=end) return {found:false, msg:"Primers orientation wrong"};
    const amp=s.slice(start,end);
    return {found:true, start:start+1, end, length:amp.length, amplicon:amp, fwdPos:fIdx+1, revPos:rIdx+1};
  }

  /* ---------- Dot plot ---------- */
  function dotPlot(seq1, seq2, win=10, threshold=8){
    const s1=clean(seq1), s2=clean(seq2);
    const points=[];
    // naive: for each i,j compare window
    for(let i=0;i+win<=s1.length;i++){
      for(let j=0;j+win<=s2.length;j++){
        let matches=0;
        for(let k=0;k<win;k++) if(s1[i+k]===s2[j+k]) matches++;
        if(matches>=threshold) points.push({x:i+1,y:j+1,matches});
      }
    }
    return {points, s1Len:s1.length, s2Len:s2.length, win, threshold};
  }

  /* ---------- Simple MSA (progressive not implemented - just pad) ---------- */
  function simpleMSA(seqs){
    // seqs: array of strings or fasta records [{id,seq}]
    let arr = seqs.map(s=> typeof s==='string'? s : s.seq);
    arr = arr.map(s=>clean(s));
    const maxLen = Math.max(...arr.map(s=>s.length));
    const aligned = arr.map(s=> s.padEnd(maxLen,'-'));
    // consensus: most common char per column
    let consensus="";
    for(let i=0;i<maxLen;i++){
      const col={}; for(const s of aligned) { const ch=s[i]; col[ch]=(col[ch]||0)+1; }
      let best='-'; let bestC=0; for(const ch in col){ if(col[ch]>bestC && ch!=='-'){best=ch; bestC=col[ch];} }
      consensus+=best;
    }
    return {aligned, consensus, length:maxLen};
  }

  /* ---------- BLAST-like k-mer search ---------- */
  function blastLike(query, dbSeqs, k=6){
    const q=clean(query);
    const db = Array.isArray(dbSeqs)? dbSeqs : parseFasta(dbSeqs);
    const dbArr = db.map(d=> typeof d==='string'? {id:'',seq:clean(d)} : {id:d.id||'', seq:clean(d.seq)});
    // build k-mer index for query
    const qKmers=new Set();
    for(let i=0;i+k<=q.length;i++) qKmers.add(q.slice(i,i+k));
    const hits=[];
    for(const entry of dbArr){
      const s=entry.seq;
      let matches=0;
      for(let i=0;i+k<=s.length;i++){ if(qKmers.has(s.slice(i,i+k))) matches++; }
      const score = s.length? matches / (s.length - k + 1) * 100 : 0;
      if(matches>0) hits.push({id:entry.id||'', length:s.length, matches, score:score.toFixed(2), seqPreview: s.slice(0,60)+(s.length>60?'…':'' )});
    }
    hits.sort((a,b)=>b.matches-a.matches);
    return {queryLen:q.length, k, hits};
  }

  /* ---------- File type detection ---------- */
  function detectFileType(text){
    const t=String(text||"").trim();
    if(t.startsWith('>')) return 'fasta';
    if(t.includes('@') && t.includes('+')) return 'fastq_maybe';
    if(t.startsWith('LOCUS')||t.includes('ORIGIN')) return 'genbank';
    if(t.includes(',') && t.split('\n')[0].includes(',')) return 'csv';
    if(/^[ACGTN\s]+$/i.test(t.slice(0,200)) && t.length>10) return 'dna';
    if(/^[ACDEFGHIKLMNPQRSTVWY\s\*]+$/i.test(t.slice(0,200))) return 'protein';
    return 'text';
  }

  return {
    clean, detectType, stats, reverseComplement, reverse, translate,
    checkAlphabet, randomDNA, randomRNA, randomProtein, gcWindow, CODON_TABLE,
    findORFs, sixFrame, iupacToRegex, findMotif, restrictionMap, proteinProperties, codonUsage, parseFasta, pairwiseIdentity,
    ENZYMES, chargeAtPH, isoelectricPoint,
    designPrimers, inSilicoPCR, dotPlot, simpleMSA, blastLike, detectFileType,
  };
})();
