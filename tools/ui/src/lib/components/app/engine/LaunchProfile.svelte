<script lang="ts">
 import { onMount } from 'svelte';
 import { engineManager } from '$lib/services/engine-manager.service';
 type Profile={schemaVersion:number;id:string;name:string;revision:number;settings:Record<string,unknown>};
 type Card={uuid:string;name:string;total:number|null;free:number|null};
 const invoke=engineManager();
 let profile=$state<Profile|null>(null), status=$state(''),busy=$state(false),cards=$state<Card[]>([]),inventoryStatus=$state('');
 const numbers=[{key:'ctx_size',label:'Context tokens (0 = model default)',min:0},{key:'parallel',label:'Parallel sequences (0 = runtime default)',min:0},{key:'n_gpu_layers',label:'GPU layers (-1 = automatic)',min:-1},{key:'batch_size',label:'Batch tokens (0 = runtime default)',min:0},{key:'ubatch_size',label:'Microbatch tokens (0 = runtime default)',min:0}];
 async function load(){if(!invoke)return;try{profile=await invoke<Profile>('read_engine_config',{engine:'llamacpp'});}catch(e){status=String(e);}}
 async function inventory(){if(!invoke)return;try{cards=JSON.parse(await invoke<string>('manager_call',{engine:'llamacpp',action:'inventory'}));inventoryStatus=cards.length?'':'No physical GPU UUIDs reported.';}catch(e){inventoryStatus=String(e);}}
 async function save(event:SubmitEvent){event.preventDefault();if(!invoke||!profile)return;busy=true;try{await invoke('save_engine_config',{engine:'llamacpp',config:$state.snapshot(profile)});await load();status='Profile saved. Restart the app to apply launch changes to the server.';}catch(e){status=String(e);}finally{busy=false;}}
 async function capabilities(){if(!invoke)return;busy=true;try{status=await invoke<string>('manager_call',{engine:'llamacpp',action:'capabilities'});}catch(e){status=String(e);}finally{busy=false;}}
 async function preview(){if(!invoke)return;busy=true;try{status=await invoke<string>('manager_call',{engine:'llamacpp',action:'plan'});}catch(e){status=String(e);}finally{busy=false;}}
 function selected():string[]{return Array.isArray(profile?.settings.selected_gpu_uuids)?profile.settings.selected_gpu_uuids as string[]:[];}
 function toggle(uuid:string,checked:boolean){if(profile)profile.settings.selected_gpu_uuids=checked?[...selected(),uuid]:selected().filter(id=>id!==uuid);}
 onMount(()=>{void load();});
</script>
{#if invoke}
<section class="mt-5 rounded-2xl border border-border bg-card p-5" data-help-key="settings">
 <details>
 <summary class="cursor-pointer font-semibold">llama.cpp GPU and launch profile</summary>
 <p class="mt-2 text-sm text-muted-foreground">These settings configure the whole llama.cpp server. Save a profile, inspect its resolved launch, then restart the app to apply it.</p>
 {#if profile}
 <form onsubmit={save} class="mt-4">
 <div class="grid gap-4 sm:grid-cols-2">
 <label class="grid gap-1 text-sm">Profile name<input class="rounded-lg border border-input bg-background px-3 py-2" bind:value={profile.name} required /></label>
 <label class="grid gap-1 text-sm" data-help-key="gpu_placement">GPU placement<select class="rounded-lg border border-input bg-background px-3 py-2" bind:value={profile.settings.gpu_placement}><option value="manual">Use selected/manual devices</option><option value="single">One card with most free memory</option><option value="spread">Spread across visible cards</option></select></label>
 {#each numbers as field (field.key)}<label class="grid gap-1 text-sm" data-help-key={field.key} data-help-title={field.label}>{field.label}<input class="rounded-lg border border-input bg-background px-3 py-2" type="number" min={field.min} max="2147483647" step="1" value={profile.settings[field.key] as number} oninput={e=>{if(profile)profile.settings[field.key]=Number(e.currentTarget.value);}} required /></label>{/each}
 <label class="grid gap-1 text-sm" data-help-key="split_mode">Split mode<select class="rounded-lg border border-input bg-background px-3 py-2" bind:value={profile.settings.split_mode}><option value="none">Single card</option><option value="layer">Layers across cards</option><option value="tensor">Tensor (experimental)</option><option value="row">Row (legacy)</option></select></label>
 <label class="grid gap-1 text-sm" data-help-key="tensor_split">Allocation weights<input class="rounded-lg border border-input bg-background px-3 py-2" bind:value={profile.settings.tensor_split} placeholder="1,1 for equal dual-card allocation" /></label>
 <label class="grid gap-1 text-sm" data-help-key="flash_attn">Flash Attention<select class="rounded-lg border border-input bg-background px-3 py-2" bind:value={profile.settings.flash_attn}><option value="auto">Automatic</option><option value="on">On</option><option value="off">Off</option></select></label>
 {#each ['cache_type_k','cache_type_v'] as key}<label class="grid gap-1 text-sm" data-help-key={key}>{key==='cache_type_k'?'K cache':'V cache'}<select class="rounded-lg border border-input bg-background px-3 py-2" bind:value={profile.settings[key]}>{#each ['f32','f16','bf16','q8_0','q4_0','q4_1','iq4_nl','q5_0','q5_1'] as choice}<option value={choice}>{choice}</option>{/each}</select></label>{/each}
 <label class="flex items-center gap-2 text-sm" data-help-key="fit"><input type="checkbox" checked={profile.settings.fit===true} onchange={e=>{if(profile)profile.settings.fit=e.currentTarget.checked;}} /> Fit memory automatically</label>
 </div>
 <div class="mt-5 border-t border-border pt-4" data-help-key="selected_gpu_uuids"><h3 class="text-sm font-semibold">Physical GPU selection</h3><p class="mt-1 text-sm text-muted-foreground">Cards are saved by UUID in the order you select them. Leaving the selection empty uses the runtime device settings below.</p><button type="button" class="mt-3 rounded-lg border border-input px-3 py-2 text-sm" disabled={busy} onclick={inventory}>Detect GPU identities</button>
 {#if inventoryStatus}<p class="mt-2 text-sm" role="status">{inventoryStatus}</p>{/if}
 {#each cards as card (card.uuid)}<label class="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" checked={selected().includes(card.uuid)} onchange={e=>toggle(card.uuid,e.currentTarget.checked)} /><span>{card.name} · {card.free??'?'} / {card.total??'?'} MiB free<small class="block break-all text-muted-foreground">{card.uuid}</small></span></label>{/each}
 {#if selected().length}<p class="mt-2 break-all text-xs">Saved order: {selected().join(', ')}</p><button type="button" class="mt-2 underline text-sm" onclick={()=>{if(profile)profile.settings.selected_gpu_uuids=[];}}>Clear GPU selection</button>{/if}
 </div>
 <details class="mt-5"><summary class="cursor-pointer text-sm">Advanced launch options</summary><div class="mt-3 grid gap-4 sm:grid-cols-2">
 {#each [{key:'device',label:'Runtime devices (when no UUIDs selected)'},{key:'fit_target',label:'Fit headroom MiB'},{key:'fit_ctx',label:'Minimum fitted context'},{key:'llamacpp_env',label:'Custom child environment (KEY=value;KEY=value)'},{key:'extra_args',label:'Additional runtime arguments'}] as field}<label class="grid gap-1 text-sm" data-help-key={field.key} data-help-title={field.label}>{field.label}<input class="rounded-lg border border-input bg-background px-3 py-2" value={String(profile.settings[field.key]??'')} oninput={e=>{if(profile)profile.settings[field.key]=e.currentTarget.value;}} /></label>{/each}
 </div></details>
 <div class="mt-5 flex flex-wrap gap-2"><button class="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={busy}>Save launch profile</button><button type="button" class="rounded-lg border border-input px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onclick={preview}>Preview saved launch</button><button type="button" class="rounded-lg border border-input px-4 py-2 text-sm" disabled={busy} onclick={load}>Reload saved profile</button><button type="button" class="rounded-lg border border-input px-4 py-2 text-sm" disabled={busy} onclick={capabilities}>Inspect runtime package</button></div>
 </form>
 {/if}
 {#if status}<pre class="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs" aria-live="polite">{status}</pre>{/if}
 </details>
</section>
{/if}
