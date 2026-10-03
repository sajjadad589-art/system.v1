# إصلاح Telemetry المعزول — 2026-10-03

## ما ثبت بالفحص

- قناة أوامر RB951 نشطة وآخر أوامر RB1100 مكتملة. هذا لا يثبت نجاح Telemetry؛ تستخدم مستخدماً وسكربتاً منفصلين.
- CORE يظهر UNKNOWN وآخر heartbeat عند 15:37:40 بتوقيت بغداد. CONNECTOR يستمر بإرسال القياسات والأوامر.
- اختبار endpoint `isp-router-heartbeat` بالرمز المحلي الموجود وبطلب `{test:true}` رجع `ok:true, paired:true` بدون إرسال قياسات مصطنعة أو تحديث حالة الجهاز.
- سكربت `isp-core-heartbeat-v1` المحلي يتصل بـ10.10.5.1 مستخدماً `isp-telemetry` ثم يرسل النتائج عبر HTTPS. يفشل قبل HTTPS إذا رفض SSH.
- ملف إنشاء حساب Telemetry المحلي يقيد المصدر بـ172.10.13.254/32، بينما سجل RB1100 الأخير يرى محاولاته من 172.10.13.255. هذا سبب محتمل قوي، وليس إثباتاً للإعداد الحالي على الراوتر.
- صلاحيات الحساب في ملف الإعداد `read,ssh`. لم يتم تغيير الحساب أو كلمة المرور أو المفاتيح أو التوكنات من السحابة.
- لا يوجد اتصال مباشر إلى RB951 من جهاز الفحص. الملفات التالية جاهزة للتطبيق المحلي ولم تُنفذ على الراوتر.

## على RB1100 بحساب admin

افحص المصدر المسموح وحالة الحساب بدون تصدير أسرار:

```routeros
:local u [/user find where name="isp-telemetry"]; :put [/user get $u address]; :put [/user get $u group]; :put [/user get $u disabled];
/user group print detail where name="isp-telemetry-read"
```

إذا المصدر ما زال `172.10.13.254/32` والسجل الحالي يؤكد `172.10.13.255`، طبق `rb1100-telemetry-source-fix.rsc` محلياً. الملف يغيّر **Allowed Address لهذا المستخدم فقط** إلى `172.10.13.255/32`. يتوقف إذا الإعداد مختلف، ولا يغيّر بيانات الاعتماد أو Routes/NAT/PPPoE أو services أو Scheduler.

## التحقق على RB951

اختبار تفاعلي بالمستخدم الحالي، ثم أدخل كلمة المرور الموجودة محلياً:

```routeros
/system ssh address=10.10.5.1 user=isp-telemetry
```

بعد الدخول، اختبار قراءة فقط:

```routeros
:put [/system resource get version]
/quit
```

افحص سكربتات المراقبة وجدولها بدون طباعة `source` الذي قد يحتوي كلمة المرور والتوكن:

```routeros
:foreach s in=[/system script find where name~"isp.*heartbeat|isp.*telemetry"] do={ :put [/system script get $s name]; :put [/system script get $s policy]; }
:foreach s in=[/system scheduler find where name~"isp.*heartbeat|isp.*telemetry"] do={ :put [/system scheduler get $s name]; :put [/system scheduler get $s disabled]; :put [/system scheduler get $s interval]; :put [/system scheduler get $s run-count]; }
```

إذا السكربت المثبت فعلاً اسمه `isp-core-heartbeat-v1`، شغله مرة واحدة:

```routeros
/system script run isp-core-heartbeat-v1
```

لا تشغل اسم سكربت غير موجود، ولا تعدل Command Worker. نجاح التحقق يحتاج تقدم `last_seen_at` للـCORE وعودة ONLINE مع قياسات فعلية. إذا نجح الدخول التفاعلي وفشل السكربت، افحص محلياً كلمة المرور المخزنة وصلاحيات Script/Scheduler ومفاتيح SSH للمستخدم؛ لا تدوّر أي credential من السحابة. إذا الإعداد مسموح أصلاً وفشل التفاعلي، فلا تطبق تغيير المصدر وتحتاج فحص مصادقة الحساب محلياً.

## الرجوع

`rb1100-telemetry-source-rollback.rsc` يعيد Allowed Address إلى `.254/32` فقط، ويتوقف إذا تغير الإعداد عن القيمة التي طبقها الإصلاح.

مرجع قيد مصدر تسجيل الدخول: https://manual.mikrotik.com/docs/authentication-authorization-accounting/user/
