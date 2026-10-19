# حادثة النشر 2026-10-19 — فشل ترحيل `it_tickets` (P3009)

## الخلاصة التنفيذية

فشل نشر Coolify على `workspace.zakiai.io` بـ **P3009** وترحيل فاشل
`20261017123500_it_tickets`. السبب الجذري: **خطأ ترتيب الترحيلات** — ترحيل
`it_tickets` (12:35) ينشئ مفتاحًا أجنبيًا على جدول `Department`، بينما الترحيل
الذي ينشئ `Department` هو `departments` (13:35) ويُطبَّق **بعده**. النشر على قاعدة
إنتاج فاشل دائمًا بهذا الترتيب. أُعيد إنتاج الفشل حرفيًا على قاعدة اختبار نظيفة،
وأُصلح الترتيب، وأُثبت نجاح النشر الكامل من صفر (12 ترحيلًا، 42 جدولًا) وسلامة
بيانات قاعدة قائمة أثناء الاسترداد.

---

## 1) الخطأ الأصلي (المثبت بالأدلة)

`20261017123500_it_tickets/migration.sql` سطر 39:

```sql
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ...
```

جدول `Department` يُنشأ في `20261017133500_departments` — يُطبَّق **بعد** `it_tickets`
بحسب الترتيب الزمني لأسماء المجلدات. أثناء `migrate deploy` على قاعدة إنتاج:

```
Applying migration `20261017123500_it_tickets`
ERROR 42P01: relation "Department" does not exist
→ P3018 → ثم P3009 عند كل النشرات التالية حتى المعالجة
```

- الترحيلات السبعة السابقة (init → file_library) لا تنشئ `Department`.
- أثر `production_goals` (13:00) يعاني من المشكلة نفسها (`Routine`/`Goal` لهما
  FK على `Department` لكن أقرب من ناحية الرقم — كان سيفشل لاحقًا لو نجح
  `it_tickets` بأي وسيلة).

## 2) إعادة الإنتاج (قاعدة اختبار نظيفة منفصلة — `zaki_deploy_test`)

| الخطوة | النتيجة |
|---|---|
| `migrate deploy` بالترتيب القديم على قاعدة فارغة | **فشل مطابق**: نفس الترحيل، نفس `42P01` |
| فحص الجداول بعد الفشل | **لا جدول `Ticket`** — المعاملة تراجعت بالكامل (لا تغييرات جزئية) |
| `_prisma_migrations` | صف `it_tickets`: `finished_at = NULL`, `rolled_back_at = NULL` |

هذا يثبت أمرين:
1. السبب هو التبعية المعكوسة، لا صلاحيات ولا بيانات ولا تشفير.
2. **لا تغييرات جزئية في قاعدة الإنتاج** — إذن `resolve --rolled-back` مبرر وآمن.

## 3) الإصلاح المطبق في المستودع

**إعادة تسمية مجلد** (تعديل الترتيب الزمني ليطابق التبعيات):

```
prisma/migrations/20261017133500_departments  →  prisma/migrations/20261017123000_departments
```

الترتيب الناتج (كل التبعيات مُرضية):

```
init → accounts_ideas → integrations → event_optional_link → internal_chat
     → file_library → departments(12:30) → it_tickets(12:35)
     → production_goals(13:00) → crm_models → ticket_comments_activity
     → campaign_calendar
```

لا تعديل على أي SQL ترحيل، ولا حذف، ولا `db push`، ولا `reset`.

**تحقق ما بعد الإصلاح على قاعدة نظيفة:** `migrate deploy` → **نجاح كامل**
(12/12 ترحيلًا `finished=yes`، 42 جدولًا بما فيها `Ticket`, `Department`,
`Campaign`, `Customer`...).

## 4) استرداد قاعدة موجودة (مثبت بمحاكاة كاملة)

قاعدة قائمة طبّقت `departments` بالاسم القديم (مثل قاعدة التطوير المحلية):
بعد إعادة التسمية، `deploy` يفشل `P3018` على `20261017123000_departments`
(الجدول موجود). المعالجة المثبتة:

1. **فحص بالأدلة قبل أي resolve** — هل مخطط `departments` كامل؟
   ```sql
   -- للقراءة فقط
   SELECT to_regclass('"Department"')::text;
   SELECT count(*) FROM pg_constraint WHERE conname IN
     ('Department_orgId_fkey','DepartmentMember_departmentId_fkey',
      'DepartmentMember_userId_fkey','Project_departmentId_fkey');   -- يجب 4
   SELECT count(*) FROM information_schema.columns
    WHERE table_name='Project' AND column_name='departmentId';        -- يجب 1
   ```
2. إذا كانت النتيجة مطابقة: `npx prisma migrate resolve --applied 20261017123000_departments`
3. `npx prisma migrate deploy` — يكمل الباقي (it_tickets وما بعده).
4. فحص بيانات بعد الاسترداد: صفوف المؤسسة/المستخدمين سليمة (أثبتها بمحاكاة
   صفت إدراج بيانات حقيقية قبل الاسترداد وبقيت بعده: `DataLossCheck INTACT`).

## 5) خطة إصلاح قاعدة إنتاج Coolify (بانتظار موافقتك)

لا يملك هذا الجلسة وصولًا لقاعدة الإنتاج؛ الخطوات تعتمد على حالتها الفعلية —
نفّذ **الاستعلامات القراءة-فقط أولًا** من Terminal خدمة PostgreSQL في Coolify
(أو `prisma migrate status` من حاوية التطبيق):

### الحالة الأكثر ترجيحًا (قاعدة جديدة فشلت في it_tickets)
```
# من حاوية التطبيق (Terminal في Coolify):
npx prisma migrate resolve --rolled-back 20261017123500_it_tickets
npx prisma migrate deploy
```
`--rolled-back` مبرر بالأدلة أعلاه (المعاملة تراجعت بالكامل — لا تغييرات جزئية
يجب استكمالها). بعد سحب الـ commit الجديد سيطبق deploy بقية الترحيلات بالترتيب
الصحيح.

### حالة بديلة (قاعدة قائمة فيها `Department` موجود أصلًا)
إن أظهر الفحص أن `Department` موجود والترحيل الفاشل تسجله `_prisma_migrations`
باسم مختلف (مثل `departments`)، أرسل لي مخرجات استعلام الحالة وسأعطي الأمر
المطابق — المنطق نفسه: تحقق بالأدلة ثم resolve بالاتجاه الصحيح.

### التحقق بعد الإصلاح
```
npx prisma migrate status        # "Database schema is up to date!"
SELECT count(*) FROM pg_tables WHERE schemaname='public';  -- 42 جدولًا
curl -s https://workspace.zakiai.io/api/health             # {"status":"ok"}
```
ثم أعد النشر — حاوية البناء الجديد ستجتاز `migrate deploy` لأن الترتيب صحيح
وقاعدة الإنتاج مسجّلة كاملة.

## 6) ما تم التحقق منه مقابل ما تبقى مجهولًا

**مُتحقق عليه (محليًا بقاعدة اختبار معزولة):** سبب الفشل حرفيًا · تراجع المعاملة
الكامل · نجاح النشر من الصفر بعد الإصلاح · استرداد قاعدة قائمة بالاسم القديم
بلا فقد بيانات · tsc/vitest (115/115)/build أخضر.

**غير قابل للتحقق من هنا:** الحالة الفعلية لقاعدة إنتاج Coolify (استعلامات
القراءة-فقط §5.1 تعطيك صورتها الدقيقة) · سجلات محاولة النشر الأولى لديكم.

## 7) ملفات تغيرت في هذا الإصلاح

| الملف | التغيير |
|---|---|
| `prisma/migrations/20261017133500_departments/` → `20261017123000_departments/` | إعادة تسمية فقط (SQL لم يُلمس) |
| `prisma/migrations/20261017123500_it_tickets/migration.sql` | استعادة المحتوى الأصلي كاملًا (كان انخفض محتواه أثناء فحص مبكر في هذه الجلسة — استُعيد حرفيًا من قراءة موثقة قبل التعديل) |
| `docs/DEPLOYMENT-INCIDENT-2026-10-19.md` | هذا التقرير |

لا يوجد أي تعديل على `schema.prisma` ولا migration جديدة.