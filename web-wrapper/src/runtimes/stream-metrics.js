'use strict';
class StreamTiming {
 constructor(startedAt=performance.now()){this.startedAt=startedAt;this.first=null;this.contentFirst=null;this.tokens=null;}
 observe(event,at=performance.now()){
  const nonempty=value=>typeof value==='string'&&value.length>0;
  for(const choice of event.choices||[]){const delta=choice.delta||{};const content=nonempty(delta.content);const generated=content||nonempty(delta.reasoning_content)||nonempty(delta.reasoning)||(delta.tool_calls||[]).some(call=>nonempty(call.function?.arguments)||nonempty(call.function?.name))||nonempty(delta.function_call?.arguments);
   if(generated&&this.first===null)this.first=at;if(content&&this.contentFirst===null)this.contentFirst=at;}
  if(Number.isInteger(event.usage?.completion_tokens)&&event.usage.completion_tokens>=0)this.tokens=event.usage.completion_tokens;
 }
 result(finishedAt=performance.now()){
  const decodeMs=this.first===null?null:Math.max(0,finishedAt-this.first);
  return{ttftMs:this.first===null?null:this.first-this.startedAt,contentTtftMs:this.contentFirst===null?null:this.contentFirst-this.startedAt,totalMs:finishedAt-this.startedAt,completionTokens:this.tokens,tokensPerSecond:decodeMs>0&&this.tokens>1?(this.tokens-1)/(decodeMs/1000):null};
 }
}
module.exports={StreamTiming};
