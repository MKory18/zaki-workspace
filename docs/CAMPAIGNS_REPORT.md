# تقويم الحملات — تقرير المرحلة الكاملة (2026-10-19)

## الوحدة الثالثة داخل الأقسام (بعد تذاكر IT و CRM)

| الملف | التغيير |
|---|---|
| `prisma/schema.prisma` | `CampaignStatus` enum (DRAFT/SCHEDULED/RUNNING/DONE/CANCELLED) + `Campaign` (ترقيم `C{n}` لكل مؤسسة، نطاق تواريخ، أولوية، مالك) + `CampaignItem` (عناصر مؤرخة: بوست/حدث/مهمة، بإنجاز `doneAt`) |
| `prisma/migrations/20261019200000_campaign_calendar/` | migration إضافية (CreateEnum + CreateTable ×2 + فهارس + FK) — نُفذت على قاعدة الاختبار المحلية فقط |
| `src/server/services/campaigns.ts` | CRUD كامل: قائمة القسم، إنشاء (عدّاد ذري داخل معاملة)، تعديل/تحويل حالة، تفاصيل مع العناصر، إضافة عنصر، toggle إنجاز، حذف عنصر، «حملاتي» |
| `src/app/api/departments/[id]/campaigns/route.ts` | GET (عزل المؤسسة) · POST |
| `src/app/api/campaigns/[id]/route.ts` | GET · PATCH · DELETE |
| `src/app/api/campaigns/[id]/items/route.ts` | POST عنصر مؤرخ |
| `src/app/api/campaign-items/[itemId]/route.ts` | POST toggle · DELETE |
| `src/app/api/campaigns/mine/route.ts` | «حملاتي» |
| `src/components/department-campaigns.tsx` | واجهة داخل بطاقة القسم: إنشاء بنموذج تواريخ+أولوية، شارات حالة ملونة، قائمة حالة، عداد النشطة، تأكيد الحذف، RTL |
| `src/components/departments-view.tsx` | تركيب واجهة الحملات تحت التذاكر في كل بطاقة قسم |
| `src/lib/i18n/ar.json` | 25 مفتاح `camp.*` + `nav.campaigns` |
| `tests/campaigns-contract.test.ts` | جديد: 9 اختبارات عقد (حالات، عدّاد ذري، عزل مؤسسة، بوابة صلاحيات، نطاق تواريخ، حراس المسارات) |

## الصلاحيات (نفس نمط التذاكر)
- أي عضو مؤسسة يقرأ/ينشئ داخل قسم مؤسسته.
- أعضاء القسم أو OWNER/ADMIN فقط يعدّلون/يحوّلون/يحذفون ويديرون العناصر.
- `startDate ≤ endDate` مفروض على الخادم (مرفوض الطلب المعكوس في الاختبار الحي).
- كل الاستعلامات محصورة بـ `orgId` من السياق — حساب خارج المؤسسة: 404 بلا كشف وجود.

## الاختبارات الفعلية

| الاختبار | النتيجة |
|---|---|
| `tsc --noEmit` | **PASS** (0) |
| `vitest run` | **PASS — 103/103** (16 ملفًا) |
| `prisma validate` + `migrate deploy` | **PASS** |
| `npm run build` | **PASS** |
| دورة حيّة: إنشاء C8 «حملة رمضان» → إضافة عنصر مؤرخ → تحويل RUNNING → رفض نطاق معكوس → toggle إنجاز → حذف | **PASS** |
| عزل: حساب خارج المؤسسة GET detail / toggle = 404 | **PASS** |
| Docker/Coolify | **BLOCKED** — لا Docker محليًا |

## متبقٍ (موثق)
- لوحة تقويم شهرية مرئية (القائمة الحالية جدول زمني مرتب) — المرحلة القادمة إن طُلب.
- ربط العناصر بمهام حقيقية (kind=task حاليًا نصي فقط).

الترقيم المشترك `C{n}` لا يتعارض مع `ZD-T{n}` ولا `{prefix}-{n}` — عدّاد واحد لكل مؤسسة بتسلسل مشترك (تصميم موجود لم يُلمس).