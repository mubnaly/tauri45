// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { Lang } from './types';
import { state } from './store';

/**
 * Two-language dictionary carried over from `mobile45/src/assets/lang`.
 * Arabic is first-class and drives document direction.
 */
const EN: Record<string, string> = {
    'app.tagline': 'Learn anywhere, even offline',
    'nav.courses': 'Courses',
    'nav.cards': 'Flashcards',
    'nav.social': 'Community',
    'nav.chats': 'Chats',
    'nav.profile': 'Profile',
    'login.title': 'Sign in',
    'login.tenant': 'Tenant code',
    'login.tenantHint': 'e.g. safwa, maher, dalgamoun',
    'login.site': 'Site URL (optional)',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.demo': 'Demo mode: any username and password work (use "fail" to see an error).',
    'login.known': 'Known tenants',
    'login.security': 'Web-service tokens stay in the native vault, never in the browser.',
    'courses.title': 'My courses',
    'courses.sync': 'Sync from site',
    'courses.offline': 'Offline cache',
    'courses.empty': 'No cached courses yet. Sync while online to fill the offline cache.',
    'courses.progress': 'progress',
    'courses.open': 'Open course',
    'course.modules': 'Activities',
    'course.back': 'Back to courses',
    'player.quality': 'Quality',
    'player.capture': 'Block screen capture',
    'player.captureOn': 'Capture protection is on',
    'player.offline': 'Download for offline',
    'player.progress': 'Watched',
    'player.queue': 'Queue offline attempt',
    'cards.title': 'Flashcards',
    'cards.show': 'Show answer',
    'cards.again': 'Again',
    'cards.good': 'Got it',
    'cards.done': 'Deck complete — XP saved offline',
    'cards.hint': 'Review awards XP and queues an offline attempt.',
    'social.title': 'Community',
    'social.placeholder': 'Share something with your class…',
    'social.post': 'Post',
    'social.like': 'Like',
    'social.scope': 'Tenant-isolated feed',
    'chats.title': 'Chats',
    'chats.empty': 'Select a conversation',
    'chats.placeholder': 'Write a message…',
    'chats.send': 'Send',
    'profile.title': 'Profile',
    'profile.badges': 'Badges & XP',
    'profile.security': 'Security',
    'profile.storage': 'Storage',
    'profile.sync': 'Offline queue',
    'profile.flush': 'Sync now',
    'profile.logout': 'Sign out',
    'profile.integrity': 'Integrity check',
    'profile.protection': 'Screen capture protection',
    'profile.pending': 'pending',
    'profile.device': 'Device',
    'family.video': 'Video',
    'family.pdf': 'PDF',
    'family.flashcard': 'Flashcards',
    'family.usage': 'Usage',
    'family.streak': 'Streak',
    'common.level': 'Level',
    'common.xp': 'XP',
    'common.retry': 'Try again',
    'common.language': 'العربية',
    'common.close': 'Close',
};

const AR: Record<string, string> = {
    'app.tagline': 'تعلّم في أي مكان، حتى دون اتصال',
    'nav.courses': 'المقررات',
    'nav.cards': 'البطاقات',
    'nav.social': 'المجتمع',
    'nav.chats': 'المحادثات',
    'nav.profile': 'الملف',
    'login.title': 'تسجيل الدخول',
    'login.tenant': 'رمز المؤسسة',
    'login.tenantHint': 'مثال: safwa، maher، dalgamoun',
    'login.site': 'رابط الموقع (اختياري)',
    'login.username': 'اسم المستخدم',
    'login.password': 'كلمة المرور',
    'login.submit': 'دخول',
    'login.demo': 'وضع العرض: أي اسم مستخدم وكلمة مرور تعمل (استخدم "fail" لرؤية الخطأ).',
    'login.known': 'المؤسسات المعروفة',
    'login.security': 'تبقى رموز خدمة الويب في الخزنة الأصلية ولا تصل إلى المتصفح.',
    'courses.title': 'مقرراتي',
    'courses.sync': 'مزامنة من الموقع',
    'courses.offline': 'النسخة المحلية',
    'courses.empty': 'لا توجد مقررات محفوظة. زامن أثناء الاتصال لتعبئة النسخة المحلية.',
    'courses.progress': 'التقدم',
    'courses.open': 'فتح المقرر',
    'course.modules': 'الأنشطة',
    'course.back': 'رجوع إلى المقررات',
    'player.quality': 'الجودة',
    'player.capture': 'منع تصوير الشاشة',
    'player.captureOn': 'حماية التصوير مفعّلة',
    'player.offline': 'تنزيل للاستخدام دون اتصال',
    'player.progress': 'تمت المشاهدة',
    'player.queue': 'إضافة محاولة للمزامنة',
    'cards.title': 'البطاقات التعليمية',
    'cards.show': 'إظهار الإجابة',
    'cards.again': 'مرة أخرى',
    'cards.good': 'عرفتها',
    'cards.done': 'انتهت المجموعة — تم حفظ النقاط محليًا',
    'cards.hint': 'المراجعة تمنح نقاطًا وتضيف محاولة إلى قائمة المزامنة.',
    'social.title': 'المجتمع',
    'social.placeholder': 'شارك شيئًا مع صفك…',
    'social.post': 'نشر',
    'social.like': 'إعجاب',
    'social.scope': 'مجتمع معزول لكل مؤسسة',
    'chats.title': 'المحادثات',
    'chats.empty': 'اختر محادثة',
    'chats.placeholder': 'اكتب رسالة…',
    'chats.send': 'إرسال',
    'profile.title': 'الملف الشخصي',
    'profile.badges': 'الأوسمة والنقاط',
    'profile.security': 'الأمان',
    'profile.storage': 'التخزين',
    'profile.sync': 'قائمة المزامنة',
    'profile.flush': 'زامن الآن',
    'profile.logout': 'تسجيل الخروج',
    'profile.integrity': 'فحص السلامة',
    'profile.protection': 'حماية تصوير الشاشة',
    'profile.pending': 'قيد الانتظار',
    'profile.device': 'الجهاز',
    'family.video': 'الفيديو',
    'family.pdf': 'الملفات',
    'family.flashcard': 'البطاقات',
    'family.usage': 'الاستخدام',
    'family.streak': 'الاستمرارية',
    'common.level': 'المستوى',
    'common.xp': 'نقطة',
    'common.retry': 'إعادة المحاولة',
    'common.language': 'English',
    'common.close': 'إغلاق',
};

const DICTIONARIES: Record<Lang, Record<string, string>> = { en: EN, ar: AR };

export function t(key: string): string {
    return DICTIONARIES[state.lang][key] ?? EN[key] ?? key;
}

export function otherLang(): Lang {
    return state.lang === 'ar' ? 'en' : 'ar';
}

export function isRtl(): boolean {
    return state.lang === 'ar';
}
