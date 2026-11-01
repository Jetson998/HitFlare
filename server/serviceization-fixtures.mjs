// Synthetic credentials only. Never use this keyring for deployment.
export const testKeyring = {active:"test-v1",keys:{"test-v1":Buffer.alloc(32,7).toString("base64")}};
export const testChannel = {id:"test-channel",name:"测试渠道",baseUrl:"https://provider.example/v1",apiKey:"synthetic-only-key",apiFormat:"openai",models:[{name:"test",capability:"text"}]};
export const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=","base64");
export const observation = {
    classification:{medium:"mixed",subjects:["other"],layoutTypes:["scene"]},summary:"测试画面",
    facts:["subject","composition","color","medium"].map((dimension,index)=>({id:`fact-${index}`,dimension,description:`测试${dimension}`,status:"observed",evidence:"画面中心"})),
    uncertainItems:[],reusableElements:[],
    styleProfile:{medium:"混合媒介",composition:"居中",lighting:"未体现",palette:"白色",material:"未体现",atmosphere:"简洁",typography:"无文字",factIds:["fact-0"]},
    reversePromptDraft:{sections:{subject:"主体",environment:"白色背景",composition:"居中",lightingColor:"白色",materialMedium:"混合媒介",mood:"简洁"},text:"主体居中，白色背景，简洁的混合媒介画面。",factIds:["fact-0"]},
};
