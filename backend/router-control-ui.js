  const remoteControl={routerId:'',jobs:[],busy:false,loading:false,draft:'/system resource print',requestId:null,error:''};
  const remotePresets=[
    ['حالة الراوتر','/system resource print'],['المنافذ','/interface print detail without-paging'],
    ['عناوين IP','/ip address print detail without-paging'],['المسارات','/ip route print detail without-paging'],
    ['الجدار الناري','/ip firewall filter print detail without-paging'],['NAT','/ip firewall nat print detail without-paging'],
    ['جلسات PPPoE','/ppp active print without-paging'],['بروفايلات PPP','/ppp profile print without-paging'],
    ['السرعات والـQueues','/queue simple print detail without-paging'],['DHCP','/ip dhcp-server print detail without-paging'],
    ['DNS','/ip dns print'],['Bridge','/interface bridge print detail without-paging'],
    ['الخدمات','/ip service print without-paging'],['الملفات','/file print without-paging'],
    ['السجل','/log print without-paging where topics~"error|warning"'],['الوقت','/system clock print'],
    ['نسخة إعدادات على الراوتر','/export hide-sensitive file=isp-control-manual-backup'],['إعادة تشغيل','/system reboot']
  ];
  const remoteStatus={PENDING:'بانتظار الراوتر',EXECUTING:'جارٍ التنفيذ',COMPLETED:'اكتمل',FAILED:'فشل',UNKNOWN:'النتيجة غير مؤكدة',CANCELED:'ملغي',EXPIRED:'انتهت مهلة الانتظار'};
  function selectedControlRouter(){return state.routers.find(r=>r.id===remoteControl.routerId&&r.device_role==='CORE')||state.routers.find(r=>r.device_role==='CORE');}
  async function remoteApi(body){return api('/functions/v1/isp-router-control',{method:'POST',body:JSON.stringify(body)});}
  function renderRouterControl(){
    if(!isOwner()){$('#content').innerHTML='<div class="empty">التحكم بالراوتر بورد متاح لمالك النظام فقط.</div>';return;}
    const router=selectedControlRouter();if(router)remoteControl.routerId=router.id;
    const channel=commandChannelState();
    $('#content').innerHTML='<div class="calm-head"><div><h1>التحكم بالراوتر بورد</h1><div class="muted">اختر أمراً سريعاً أو اكتب أوامر RouterOS لإدارة الراوتر.</div></div></div>'+
    '<div class="rc-layout"><section class="card card-pad"><div class="field"><label for="rc-router">الراوتر المستهدف</label><select id="rc-router">'+state.routers.map(r=>'<option value="'+esc(r.id)+'" '+(r.id===router?.id?'selected':'')+' '+(r.device_role!=='CORE'?'disabled':'')+'>'+esc(r.name||r.model)+' • '+esc(r.routeros_version||'')+(r.device_role!=='CORE'?' — قناة عبور':'')+'</option>').join('')+'</select></div>'+
    '<div class="row wrap"><span class="badge '+(channel.state==='ok'?'online':'offline')+'">'+esc(channel.label)+'</span><span class="muted">'+esc(router?.model||'لا يوجد راوتر رئيسي')+'</span></div>'+
    '<p class="hint">الأوامر تعمل بصلاحيات حساب الربط على الراوتر. العمليات التي تقطع الاتصال قد تنفذ دون وصول تأكيد؛ لا تُعاد تلقائياً.</p>'+
    '<div class="rc-presets">'+remotePresets.map((p,i)=>'<button type="button" class="btn small" data-rc-preset="'+i+'">'+esc(p[0])+'</button>').join('')+'</div></section>'+
    '<section class="card card-pad"><form id="rc-form"><label for="rc-script"><b>Terminal RouterOS</b></label><textarea id="rc-script" class="input rc-terminal" dir="ltr" spellcheck="false" maxlength="8000" rows="10"></textarea>'+
    '<div class="hint">الأزرار تضع الأمر في المحرر للمراجعة. أوامر print البسيطة تُعرض كبيانات. للسكربتات استخدم :return لإرجاع نتيجة؛ :put لا يرجع نصاً لهذه اللوحة. الأوامر مستقلة وليست جلسة تفاعلية، وتُختصر النتائج الطويلة.</div>'+
    '<div class="row wrap" style="margin-top:12px"><button id="rc-send" class="btn primary" '+(!router||channel.state!=='ok'||remoteControl.busy?'disabled':'')+'>مراجعة وتنفيذ</button><button type="button" id="rc-refresh" class="btn">تحديث النتائج</button></div></form><p id="rc-error" role="alert"></p></section></div>'+
    '<section class="card card-pad" style="margin-top:14px"><h2 class="section-title">سجل الأوامر والنتائج</h2><div id="rc-history" aria-live="polite"></div></section>';
    $('#rc-script').value=remoteControl.draft;
    $('#rc-script').addEventListener('input',e=>{remoteControl.draft=e.target.value;remoteControl.requestId=null;});
    $('#rc-router').addEventListener('change',e=>{remoteControl.routerId=e.target.value;remoteControl.requestId=null;renderRouterControl();});
    $$('[data-rc-preset]').forEach(b=>b.addEventListener('click',()=>{remoteControl.draft=remotePresets[Number(b.dataset.rcPreset)][1];remoteControl.requestId=null;$('#rc-script').value=remoteControl.draft;$('#rc-script').focus();}));
    $('#rc-form').addEventListener('submit',e=>{e.preventDefault();reviewRemoteCommand();});
    $('#rc-refresh').addEventListener('click',()=>loadRemoteJobs());
    renderRemoteHistory();loadRemoteJobs();
  }
  function renderRemoteHistory(){
    const target=$('#rc-history');if(!target||state.page!=='router-control')return;
    const jobs=remoteControl.jobs.filter(j=>j.router_id===remoteControl.routerId);
    target.innerHTML=jobs.length?jobs.map(j=>'<article class="rc-job"><div class="row between wrap"><b>'+esc(remoteStatus[j.status]||j.status)+'</b><span class="muted">'+esc(fmtDate(j.created_at))+'</span></div><pre dir="ltr">'+esc(j.script)+'</pre><pre dir="ltr" class="rc-output">'+esc(j.output??(j.status==='UNKNOWN'?'لا يوجد تأكيد نهائي. راجع حالة الراوتر قبل إعادة الأمر.':j.status==='EXPIRED'?'لم يُسلّم الأمر للراوتر خلال المهلة.':j.status==='COMPLETED'?'تم التنفيذ بدون مخرجات نصية.':'بانتظار النتيجة…'))+'</pre>'+(j.status==='PENDING'?'<button type="button" class="btn small" data-rc-cancel="'+esc(j.id)+'">إلغاء قبل التنفيذ</button>':'')+'</article>').join(''):'<div class="empty">لا توجد أوامر تحكم بعد.</div>';
    $$('[data-rc-cancel]').forEach(b=>b.addEventListener('click',async()=>{b.disabled=true;try{const r=await remoteApi({action:'cancel',id:b.dataset.rcCancel});if(!r.canceled)toast('سبق تسليم الأمر، لا يمكن إلغاؤه من الطابور');await loadRemoteJobs();}catch(e){toast(e.message,true);b.disabled=false;}}));
    const error=$('#rc-error');if(error)error.textContent=remoteControl.error;
  }
  async function loadRemoteJobs(){
    if(!isOwner()||remoteControl.loading)return;remoteControl.loading=true;
    try{const r=await remoteApi({action:'list'});remoteControl.jobs=r.jobs||[];remoteControl.error='';}
    catch(e){remoteControl.error=e.message||'تعذر تحميل النتائج';}
    finally{remoteControl.loading=false;renderRemoteHistory();}
  }
  function reviewRemoteCommand(){
    if(!isOwner()||remoteControl.busy)return;const router=selectedControlRouter();const script=remoteControl.draft.trim();
    if(!router||!script){toast('اختر الراوتر واكتب الأمر',true);return;}
    if(new TextEncoder().encode(script).length>8000){toast('الأمر أكبر من الحد المسموح',true);return;}
    openModal('<div class="modal-head"><h3>تأكيد أمر الراوتر</h3><button type="button" class="btn" onclick="closeModal()">إلغاء</button></div><p>الراوتر: <b>'+esc(router.name||router.model)+'</b></p><pre class="rc-review" dir="ltr">'+esc(script)+'</pre><form id="rc-confirm"><div class="field"><label for="rc-confirm-name">اكتب اسم الراوتر للتأكيد: '+esc(router.name||router.model)+'</label><input id="rc-confirm-name" required autocomplete="off"></div><button class="btn danger">تنفيذ على الراوتر</button></form>');
    $('#rc-confirm').addEventListener('submit',async e=>{
      e.preventDefault();if($('#rc-confirm-name').value!==(router.name||router.model)){toast('اسم الراوتر غير مطابق',true);return;}
      if(remoteControl.busy)return;remoteControl.busy=true;e.submitter.disabled=true;
      remoteControl.requestId=remoteControl.requestId||crypto.randomUUID();
      try{await remoteApi({action:'enqueue',router_id:router.id,script,confirmed:true,request_id:remoteControl.requestId});remoteControl.requestId=null;closeModal();toast('تم إرسال الأمر للطابور');await loadRemoteJobs();}
      catch(err){toast(err.message,true);e.submitter.disabled=false;}
      finally{remoteControl.busy=false;}
    });
  }
  setInterval(()=>{if(state.page==='router-control'&&isOwner()&&!document.hidden)loadRemoteJobs();},4000);
