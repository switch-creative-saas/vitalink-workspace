const a=(e=300)=>new Promise(t=>setTimeout(t,e)),n={outbreakDetails:new Map};async function o(e){return await a(350),n.outbreakDetails.get(e)||null}export{o as getOutbreakDetails};
