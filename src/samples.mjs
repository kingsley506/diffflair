export const samples = {
  webhook: [
    {id:'ord_1042',status:'processing',customer:{name:'Alex Chen',plan:'starter'},total:49,currency:'USD',items:[{sku:'API-START',quantity:1}],metadata:{region:'us-east-1'},api_key:'demo_key_before',updated_at:'2026-10-14T08:00:00Z'},
    {id:'ord_1042',status:'completed',customer:{name:'Alex Chen',plan:'pro'},total:99,currency:'USD',items:[{sku:'API-START',quantity:1}],metadata:{region:'eu-west-1'},receipt_url:'https://example.com/receipts/1042',api_key:'demo_key_after',updated_at:'2026-10-14T08:05:00Z'}
  ],
  config: [
    {app:'studio',version:'1.0',features:{darkMode:true,beta:false},limits:{requests:1000},legacy_endpoint:'/v1',credentials:{token:'demo_old'},updated_at:'10:00'},
    {app:'studio',version:'1.1',features:{darkMode:true,beta:true},limits:{requests:5000},region:'global',credentials:{token:'demo_new'},updated_at:'10:05'}
  ],
  array: [
    {team:[{id:1,name:'Alex',role:'viewer'},{id:2,name:'Sam',role:'editor'},{id:3,name:'Lee',role:'viewer'}],tags:['api','stable','old']},
    {team:[{id:1,name:'Alex',role:'admin'},{id:2,name:'Sam',role:'editor'}],tags:['api','stable','new','v2']}
  ]
};
