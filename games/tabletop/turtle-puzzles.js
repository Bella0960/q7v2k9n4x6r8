// Original non-graphic lateral-thinking puzzles. Internal trusted catalog.
// Bundled content is not cryptographically secret from someone inspecting JS.
// Guessing-role prompts must receive only the rule engine's public projection.
const puzzles=[
 {id:'rain-window',title:'雨中的窗',difficulty:'easy',prompt:'下雨时，小店的窗户外面全是水珠，店主却说今天没有下雨。他没有说谎。为什么？',
 answer:'窗外的水珠来自清洁工洗窗户。店主说的下雨是自然降雨，并没有发生。',
 hints:['水珠不一定来自天空。','有人正在做一项日常清洁工作。'],
 facts:[['weather','水珠是自然降雨造成的吗？','no'],['clean','有人正在清洁窗户吗？','yes'],['inside','店主在店里吗？','irrelevant'],['water','水珠来自人为喷水吗？','yes']]},
 {id:'silent-clock',title:'安静的钟',difficulty:'easy',prompt:'一位学生每天早晨看同一只钟，却从来不用它判断现在几点。那只钟没有坏。为什么？',
 answer:'那是一只用于记录运动时间的秒表，学生每天用它计时晨练，而不是看当前时刻。',
 hints:['钟的用途不一定是显示当前时间。','学生正在记录一段活动的时长。'],
 facts:[['broken','钟坏了吗？','no'],['sport','这与运动有关吗？','yes'],['timing','这只钟用来计算经过的时间吗？','yes'],['color','钟的颜色重要吗？','irrelevant']]},
 {id:'empty-box',title:'空盒子的订单',difficulty:'normal',prompt:'顾客在商店付钱买了一个盒子，店员把盒子里的东西全部取走，顾客反而很满意。为什么？',
 answer:'顾客买的是展示用的空收纳盒，盒内原来放着店员用于陈列的样品，店员将样品取出后才交付盒子。',
 hints:['顾客想买的东西并不是盒子里的物品。','盒内物品只是商店的展示样品。'],
 facts:[['box','顾客真正想买的是盒子本身吗？','yes'],['gift','店员是在给顾客额外赠品吗？','no'],['display','盒里的东西是展示样品吗？','yes'],['cash','支付方式重要吗？','irrelevant']]},
 {id:'library-note',title:'图书馆的留言',difficulty:'normal',prompt:'一本书被放回原位后，管理员收到一张写着“终于找到你”的留言。留言不是写给书，也不是写给任何人。为什么？',
 answer:'读者在寻找一本书对应的书架编号，留言里的“你”指的是终于找到的正确书架位置；留言是一张记录找书过程的便签。',
 hints:['“你”指的不是有生命的对象。','读者找到了某个位置。'],
 facts:[['person','留言写给某个人吗？','no'],['place','留言中的“你”指一个位置吗？','yes'],['shelf','这与书架位置有关吗？','yes'],['ink','笔的颜色重要吗？','irrelevant']]},
 {id:'late-train',title:'提前的车票',difficulty:'normal',prompt:'乘客到车站后发现车已经离开，却没有误车。他手里的车票也没有买错。为什么？',
 answer:'离开的是更早的一班同方向列车，乘客自己的列车还没有发车。',
 hints:['同一个方向可能有不止一班车。','离开的车不一定是票上的那班。'],
 facts:[['same','离开的是他票上的那班车吗？','no'],['earlier','有更早的同方向班次吗？','yes'],['future','他自己的车还未发车吗？','yes'],['seat','座位号重要吗？','irrelevant']]},
 {id:'two-cups',title:'两只杯子',difficulty:'normal',prompt:'桌上两只杯子里装着同一种饮料，一位客人喝完一杯后，另一杯的饮料却减少了。没人碰另一只杯子。为什么？',
 answer:'两只杯子原本用于计量同一份饮料，其中一只杯子底部连接了通向另一只杯子的细管；喝掉一杯中的液体后，两边液面重新平衡。',
 hints:['两只杯子不是完全独立的。','液体可以在两个容器之间流动。'],
 facts:[['connected','两个杯子相连吗？','yes'],['evap','饮料是因为蒸发减少的吗？','no'],['tube','存在连接液体的管子吗？','yes'],['taste','饮料味道重要吗？','irrelevant']]}
];
const copy=v=>JSON.parse(JSON.stringify(v));
export function listTurtlePuzzles(){return puzzles.map(({id,title,difficulty,prompt})=>({id,title,difficulty,prompt}));}
export function getTurtlePuzzleForRules(id){const p=puzzles.find(x=>x.id===id);if(!p)throw Error('TURTLE_UNKNOWN_PUZZLE');return copy(p);}
