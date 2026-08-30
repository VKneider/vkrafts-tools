import DOMPurify from 'dompurify';

export default class HtmlService {
   constructor(props) {
      this.props = props || {};
   }

   sanitize(html) {
      return DOMPurify.sanitize(String(html ?? ''));
   }

   escape(text) {
      return String(text ?? '')
         .replaceAll('&', '&amp;')
         .replaceAll('<', '&lt;')
         .replaceAll('>', '&gt;')
         .replaceAll('"', '&quot;')
         .replaceAll("'", '&#39;');
   }
}
