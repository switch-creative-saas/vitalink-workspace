// Terms of Use and Privacy Policy, copied from www.vitalink.africa/terms and /privacy so they can be
// read during sign-up (and offline). Generated from the website pages; when the website changes,
// regenerate this file rather than editing it by hand.
export type LegalBlock =
  | { type: 'heading' | 'subheading' | 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

export interface LegalDocument {
  title: string;
  lastUpdated: string;
  url: string;
  blocks: LegalBlock[];
}

export const LEGAL_DOCUMENTS: Record<'terms' | 'privacy', LegalDocument> = {
  "terms": {
    "title": "Terms of Use",
    "lastUpdated": "June 4, 2026",
    "url": "https://www.vitalink.africa/terms",
    "blocks": [
      {
        "type": "heading",
        "text": "1. Acceptance of Terms"
      },
      {
        "type": "paragraph",
        "text": "By accessing or using VitaLink services, you agree to be bound by these Terms of Use. If you do not agree to these terms, please do not use our services."
      },
      {
        "type": "paragraph",
        "text": "VitaLink reserves the right to modify these terms at any time. Continued use of the service after changes constitutes acceptance of the modified terms. We will notify users of material changes via email or through the platform."
      },
      {
        "type": "heading",
        "text": "2. Description of Services"
      },
      {
        "type": "paragraph",
        "text": "VitaLink provides the following healthcare technology services:"
      },
      {
        "type": "list",
        "items": [
          "Electronic Medical Records (EMR) system",
          "Telemedicine and virtual consultations",
          "Patient mobile application",
          "VitaCard NFC identity cards",
          "VitaMind AI clinical intelligence",
          "VitaLink Sentinel disease surveillance",
          "Insurance integration services",
          "Healthcare analytics and reporting"
        ]
      },
      {
        "type": "heading",
        "text": "3. Eligibility"
      },
      {
        "type": "paragraph",
        "text": "To use VitaLink services, you must:"
      },
      {
        "type": "list",
        "items": [
          "Be at least 18 years old, or have parental/guardian consent if under 18",
          "Have the legal capacity to enter into a binding agreement",
          "Not be prohibited from using the service under applicable laws",
          "Provide accurate and complete registration information"
        ]
      },
      {
        "type": "paragraph",
        "text": "Healthcare providers must have valid professional licenses and regulatory approvals to use clinical features of the platform."
      },
      {
        "type": "heading",
        "text": "4. Account Registration"
      },
      {
        "type": "paragraph",
        "text": "Users are responsible for:"
      },
      {
        "type": "list",
        "items": [
          "Maintaining the confidentiality of their password and account credentials",
          "All activities that occur under their account",
          "Providing accurate, current, and complete information during registration",
          "Updating account information to keep it accurate and current",
          "Not sharing account credentials with unauthorized individuals",
          "Immediately notifying VitaLink of any unauthorized account access"
        ]
      },
      {
        "type": "paragraph",
        "text": "Healthcare providers must verify their professional credentials before accessing clinical features."
      },
      {
        "type": "heading",
        "text": "5. Healthcare Disclaimer"
      },
      {
        "type": "paragraph",
        "text": "IMPORTANT DISCLAIMER"
      },
      {
        "type": "paragraph",
        "text": "VitaLink is a technology platform, not a healthcare provider. We do not practice medicine, provide medical diagnoses, or offer medical treatment."
      },
      {
        "type": "list",
        "items": [
          "Medical decisions remain the sole responsibility of licensed healthcare professionals",
          "VitaLink does not guarantee the accuracy or completeness of medical information on the platform",
          "Users should always seek professional medical advice for health concerns",
          "Emergency services should not be delayed while using the platform – call emergency services immediately in life-threatening situations",
          "The platform is not a substitute for in-person medical examination and diagnosis"
        ]
      },
      {
        "type": "heading",
        "text": "6. VitaMind AI Disclaimer"
      },
      {
        "type": "paragraph",
        "text": "VitaMind AI provides clinical decision support to assist healthcare professionals:"
      },
      {
        "type": "list",
        "items": [
          "AI recommendations are informational only and do not constitute medical advice",
          "All AI outputs must be reviewed and validated by qualified healthcare personnel",
          "VitaLink is not liable for clinical decisions made solely based on AI output without professional review",
          "AI may produce incorrect or incomplete information – professional judgment is always required",
          "AI does not replace the need for thorough clinical examination and patient assessment"
        ]
      },
      {
        "type": "paragraph",
        "text": "By using VitaMind AI, healthcare providers acknowledge that they remain fully responsible for all clinical decisions and patient care."
      },
      {
        "type": "heading",
        "text": "7. VitaCard Terms"
      },
      {
        "type": "paragraph",
        "text": "Terms specific to VitaCard NFC identity cards:"
      },
      {
        "type": "list",
        "items": [
          "Lost or stolen cards must be reported immediately to VitaLink support",
          "VitaCard does not contain complete medical records – only secure identifiers",
          "Emergency information on the card is limited to what you have explicitly enabled",
          "Cards remain the property of VitaLink and must be surrendered upon request",
          "Unauthorized reproduction or modification of cards is prohibited",
          "Card replacement fees may apply for lost or damaged cards"
        ]
      },
      {
        "type": "heading",
        "text": "8. Telemedicine Terms"
      },
      {
        "type": "paragraph",
        "text": "Terms for telemedicine and virtual consultation services:"
      },
      {
        "type": "list",
        "items": [
          "Explicit patient consent is required before telemedicine consultations",
          "Consultations may be recorded where legally permitted and with appropriate consent",
          "Telemedicine is not appropriate for emergency medical situations",
          "Users must ensure they have a stable internet connection for consultations",
          "Healthcare providers determine if telemedicine is appropriate for each case",
          "Prescriptions via telemedicine follow applicable regulatory requirements"
        ]
      },
      {
        "type": "heading",
        "text": "9. User Responsibilities"
      },
      {
        "type": "paragraph",
        "text": "Users agree not to:"
      },
      {
        "type": "list",
        "items": [
          "Access the platform through unauthorized means or hacking attempts",
          "Share their account credentials with others",
          "Use the platform for any unlawful or fraudulent purpose",
          "Submit false or misleading information",
          "Impersonate any person or entity",
          "Interfere with or disrupt the service or servers",
          "Attempt to reverse-engineer or copy the platform's technology",
          "Use the platform to transmit malware or harmful code",
          "Violate any applicable laws or regulations"
        ]
      },
      {
        "type": "heading",
        "text": "10. Hospital Responsibilities"
      },
      {
        "type": "paragraph",
        "text": "Healthcare facilities using VitaLink agree that:"
      },
      {
        "type": "list",
        "items": [
          "They remain the custodians of clinical decisions and patient care",
          "They must maintain proper licensing and regulatory approvals",
          "They are responsible for training their staff on proper platform use",
          "They must comply with all applicable healthcare regulations",
          "Patient consent must be obtained before sharing data through the platform",
          "They must implement appropriate access controls for their staff"
        ]
      },
      {
        "type": "heading",
        "text": "11. Government & NGO Accounts"
      },
      {
        "type": "paragraph",
        "text": "Government agencies and NGOs using VitaLink agree to:"
      },
      {
        "type": "list",
        "items": [
          "Use data solely for authorized healthcare and public health activities",
          "Comply with all applicable data protection laws",
          "Maintain appropriate security measures for accessed data",
          "Not use data for political or discriminatory purposes",
          "Respect patient privacy and confidentiality"
        ]
      },
      {
        "type": "heading",
        "text": "12. Intellectual Property"
      },
      {
        "type": "paragraph",
        "text": "All content, features, and functionality of the VitaLink platform, including but not limited to:"
      },
      {
        "type": "list",
        "items": [
          "Software, code, and algorithms",
          "Text, graphics, logos, and designs",
          "Trademarks and service marks",
          "Patents and patent applications"
        ]
      },
      {
        "type": "paragraph",
        "text": "are the exclusive property of VitaLink or its licensors and are protected by intellectual property laws. Users may not copy, modify, distribute, or create derivative works without explicit written permission."
      },
      {
        "type": "heading",
        "text": "13. Service Availability"
      },
      {
        "type": "paragraph",
        "text": "Regarding service availability:"
      },
      {
        "type": "list",
        "items": [
          "VitaLink does not guarantee uninterrupted or error-free service",
          "Scheduled maintenance may be required with advance notice where possible",
          "Service may be temporarily unavailable due to technical issues, updates, or circumstances beyond our control",
          "Offline features are available where supported, but synchronization requires internet connectivity",
          "We are not liable for damages resulting from service interruptions"
        ]
      },
      {
        "type": "heading",
        "text": "14. Limitation of Liability"
      },
      {
        "type": "paragraph",
        "text": "To the maximum extent permitted by law, VitaLink's liability is limited as follows:"
      },
      {
        "type": "list",
        "items": [
          "We are not liable for indirect, incidental, special, or consequential damages",
          "We are not liable for lost revenues, profits, or business opportunities",
          "We are not liable for data losses resulting from user negligence or unauthorized access",
          "Our total liability is limited to the amount paid by you for the service in the 12 months preceding the claim",
          "Some jurisdictions do not allow exclusion of certain damages – the above exclusions may not apply to you"
        ]
      },
      {
        "type": "paragraph",
        "text": "Nothing in these terms limits our liability for death or personal injury resulting from our negligence, or for fraud."
      },
      {
        "type": "heading",
        "text": "15. Indemnification"
      },
      {
        "type": "paragraph",
        "text": "You agree to indemnify and hold harmless VitaLink, its officers, directors, employees, and agents from any claims, damages, losses, or expenses arising from:"
      },
      {
        "type": "list",
        "items": [
          "Your use or misuse of the service",
          "Your violation of these Terms of Use",
          "Your violation of any third-party rights",
          "Your violation of applicable laws or regulations"
        ]
      },
      {
        "type": "heading",
        "text": "16. Suspension & Termination"
      },
      {
        "type": "paragraph",
        "text": "VitaLink reserves the right to:"
      },
      {
        "type": "list",
        "items": [
          "Suspend or terminate your account for violation of these terms",
          "Suspend service for security or maintenance reasons",
          "Terminate accounts that have been inactive for an extended period",
          "Refuse service to anyone at our sole discretion"
        ]
      },
      {
        "type": "paragraph",
        "text": "Upon termination, your right to use the service immediately ceases. We may retain your data as required by law or for legitimate business purposes."
      },
      {
        "type": "heading",
        "text": "17. Regulatory Compliance"
      },
      {
        "type": "paragraph",
        "text": "VitaLink complies with applicable regulations including:"
      },
      {
        "type": "list",
        "items": [
          "Nigeria Data Protection Act (NDPA)",
          "Nigeria Data Protection Regulation (NDPR)",
          "Medical and Dental Council of Nigeria regulations",
          "Other applicable healthcare and data protection regulations"
        ]
      },
      {
        "type": "paragraph",
        "text": "Users must also comply with all applicable laws and regulations in their use of the platform."
      },
      {
        "type": "heading",
        "text": "18. Governing Law"
      },
      {
        "type": "paragraph",
        "text": "These Terms of Use are governed by the laws of the Federal Republic of Nigeria. Any disputes arising from these terms shall be subject to the exclusive jurisdiction of the courts of Nigeria."
      },
      {
        "type": "paragraph",
        "text": "For international users, local laws may provide additional protections that cannot be waived by these terms."
      },
      {
        "type": "heading",
        "text": "19. Contact Information"
      },
      {
        "type": "paragraph",
        "text": "For questions about these Terms of Use, please contact:"
      },
      {
        "type": "paragraph",
        "text": "Email: legal@vitalink.africa"
      },
      {
        "type": "paragraph",
        "text": "Address: Lagos, Nigeria"
      },
      {
        "type": "paragraph",
        "text": "We will respond to your inquiry within a reasonable time."
      },
      {
        "type": "paragraph",
        "text": "By continuing to use VitaLink, you acknowledge and accept these Terms of Use."
      }
    ]
  },
  "privacy": {
    "title": "Privacy Policy",
    "lastUpdated": "June 4, 2026",
    "url": "https://www.vitalink.africa/privacy",
    "blocks": [
      {
        "type": "heading",
        "text": "1. Introduction"
      },
      {
        "type": "paragraph",
        "text": "VitaLink provides a comprehensive healthcare technology platform designed to connect patients, healthcare providers, and public health systems across Africa. Our services include:"
      },
      {
        "type": "list",
        "items": [
          "Electronic Medical Records (EMR)",
          "Health Identity Services",
          "VitaCard NFC Identity",
          "Patient Mobile Applications",
          "Telemedicine Services",
          "Insurance Integration",
          "VitaMind AI (Clinical Intelligence)",
          "VitaLink Sentinel (Disease Surveillance)",
          "Healthcare Analytics"
        ]
      },
      {
        "type": "paragraph",
        "text": "This Privacy Policy explains how we collect, use, protect, and share your personal and health information in accordance with applicable data protection laws, including the Nigeria Data Protection Act (NDPA), Nigeria Data Protection Regulation (NDPR), and GDPR principles where applicable."
      },
      {
        "type": "heading",
        "text": "2. Information We Collect"
      },
      {
        "type": "subheading",
        "text": "Patient Information"
      },
      {
        "type": "list",
        "items": [
          "Full Name",
          "Date of Birth",
          "Gender",
          "Contact Information (phone, email, address)",
          "Next of Kin details"
        ]
      },
      {
        "type": "subheading",
        "text": "Medical Information"
      },
      {
        "type": "list",
        "items": [
          "Medical diagnoses and conditions",
          "Current and past medications",
          "Laboratory test results",
          "Clinical notes and observations",
          "Allergies and adverse reactions",
          "Immunization records",
          "Vital signs and health metrics"
        ]
      },
      {
        "type": "subheading",
        "text": "Technical Information"
      },
      {
        "type": "list",
        "items": [
          "Device information and type",
          "Browser information",
          "IP address",
          "Login history and timestamps",
          "Audit logs of system access",
          "Location data (with consent)"
        ]
      },
      {
        "type": "heading",
        "text": "3. How We Use Information"
      },
      {
        "type": "paragraph",
        "text": "We use your information for the following purposes:"
      },
      {
        "type": "list",
        "items": [
          "Patient Care: To enable healthcare providers to access your medical records for diagnosis and treatment",
          "Healthcare Operations: To manage appointments, referrals, and care coordination",
          "Appointment Management: To schedule and remind you of medical appointments",
          "Clinical Decision Support: To provide healthcare professionals with relevant clinical information",
          "Disease Surveillance: To monitor and track disease patterns for public health purposes (anonymized where required)",
          "Insurance Administration: To process insurance claims and verify coverage",
          "Security Monitoring: To detect and prevent unauthorized access or fraudulent activity",
          "Regulatory Reporting: To comply with legal and regulatory requirements",
          "Service Improvement: To analyze usage patterns and improve our services"
        ]
      },
      {
        "type": "heading",
        "text": "4. Legal Basis for Processing"
      },
      {
        "type": "paragraph",
        "text": "Our processing of personal data is based on the following legal grounds under the Nigeria Data Protection Act (NDPA) and Nigeria Data Protection Regulation (NDPR):"
      },
      {
        "type": "list",
        "items": [
          "Consent: When you explicitly consent to the processing of your data for specific purposes",
          "Contract: When processing is necessary for the performance of our services under a contract",
          "Legal Obligation: When required by law for healthcare reporting, public health, or regulatory compliance",
          "Vital Interests: When necessary to protect your life or in emergency medical situations",
          "Public Task: When processing is necessary for public health surveillance and disease control",
          "Legitimate Interests: For fraud prevention, security, and service improvement, where your interests do not override"
        ]
      },
      {
        "type": "paragraph",
        "text": "For international users, we also comply with GDPR principles where applicable, including lawfulness, fairness, transparency, purpose limitation, data minimization, accuracy, storage limitation, and accountability."
      },
      {
        "type": "heading",
        "text": "5. Data Sharing"
      },
      {
        "type": "paragraph",
        "text": "VitaLink never sells personal health information. We only share your data in the following circumstances:"
      },
      {
        "type": "list",
        "items": [
          "Authorized Healthcare Providers: Doctors, nurses, and other medical professionals involved in your care",
          "Patient-Approved Parties: Individuals or organizations you have explicitly authorized to access your information",
          "Insurance Providers: To process claims and verify coverage when you have authorized insurance integration",
          "Government Authorities: When required by law, court order, or regulatory investigation",
          "Public Health Agencies: For disease surveillance and public health monitoring (anonymized or aggregated where possible)",
          "Emergency Access: When emergency medical personnel need access to critical health information",
          "Service Providers: With trusted third-party service providers who assist in operating our platform, under strict confidentiality agreements"
        ]
      },
      {
        "type": "heading",
        "text": "6. VitaCard Privacy"
      },
      {
        "type": "paragraph",
        "text": "The VitaCard NFC card is designed for secure, offline identity verification and emergency access. Important privacy features:"
      },
      {
        "type": "list",
        "items": [
          "VitaCard NFC cards do not contain complete medical records",
          "Cards only store secure identifiers that link to encrypted records on VitaLink servers",
          "Emergency access information is stored on the card only if you have explicitly enabled this feature",
          "Full medical records remain encrypted on VitaLink servers and are not stored on the physical card",
          "Card readers require proper authentication to access any information",
          "Lost or stolen cards can be immediately deactivated through your account or by contacting support"
        ]
      },
      {
        "type": "heading",
        "text": "7. Emergency Access"
      },
      {
        "type": "paragraph",
        "text": "VitaLink provides emergency access functionality to allow medical personnel to obtain critical health information in life-threatening situations when you cannot provide consent."
      },
      {
        "type": "subheading",
        "text": "Emergency Access Workflow"
      },
      {
        "type": "list",
        "items": [
          "Emergency personnel can access limited critical information (blood type, allergies, major conditions) using your VitaCard or through emergency access protocols",
          "All emergency access events are logged with timestamp, location, and requesting personnel",
          "Patients can review their complete emergency access history at any time",
          "You may choose to enable or disable emergency access features in your account settings",
          "You can specify what information is visible during emergency access"
        ]
      },
      {
        "type": "paragraph",
        "text": "Emergency access is strictly limited to situations where immediate medical attention is required and you are unable to provide consent."
      },
      {
        "type": "heading",
        "text": "8. AI Services (VitaMind)"
      },
      {
        "type": "paragraph",
        "text": "VitaMind AI provides clinical decision support to assist healthcare professionals. Important considerations:"
      },
      {
        "type": "list",
        "items": [
          "AI assists healthcare professionals – it does not replace licensed medical practitioners",
          "AI recommendations are informational and must be reviewed by qualified healthcare personnel",
          "Clinical decisions remain the responsibility of healthcare professionals",
          "VitaLink is not liable for clinical decisions made solely based on AI outputs without professional review",
          "AI processing may involve analyzing anonymized data to improve accuracy and performance",
          "AI interactions are logged for audit and quality improvement purposes"
        ]
      },
      {
        "type": "heading",
        "text": "9. Disease Surveillance (VitaLink Sentinel)"
      },
      {
        "type": "paragraph",
        "text": "VitaLink Sentinel is our disease surveillance and public health monitoring system. Privacy protections include:"
      },
      {
        "type": "list",
        "items": [
          "Sentinel uses anonymized and aggregated data for disease tracking and public health monitoring",
          "Used for outbreak detection, trend analysis, and early warning systems",
          "No personally identifiable information is disclosed without explicit authorization or legal requirement",
          "Data shared with public health agencies follows strict de-identification protocols",
          "Surveillance data is used solely for public health purposes and research"
        ]
      },
      {
        "type": "heading",
        "text": "10. Security Measures"
      },
      {
        "type": "paragraph",
        "text": "VitaLink implements industry-standard security measures to protect your health information:"
      },
      {
        "type": "list",
        "items": [
          "Encryption at Rest: All data is encrypted using AES-256 encryption when stored",
          "Encryption in Transit: All data transfers use TLS 1.3 encryption",
          "Multi-Factor Authentication (MFA): Required for all healthcare provider accounts",
          "Role-Based Access Control (RBAC): Strict access controls based on user roles and permissions",
          "Comprehensive Audit Logs: All access, modifications, and downloads are logged",
          "Secure Backups: Regular encrypted backups with disaster recovery capabilities",
          "Continuous Monitoring: 24/7 security monitoring and intrusion detection",
          "Penetration Testing: Regular security assessments by independent third parties",
          "Employee Training: All staff undergo security and privacy training"
        ]
      },
      {
        "type": "heading",
        "text": "11. User Rights"
      },
      {
        "type": "paragraph",
        "text": "Under the NDPA, NDPR, and applicable data protection laws, you have the following rights:"
      },
      {
        "type": "list",
        "items": [
          "Right to Access: Request a copy of your personal data",
          "Right to Correction: Request correction of inaccurate or incomplete data",
          "Right to Deletion: Request deletion of your data where legally permissible",
          "Right to Portability: Request transfer of your data to another service",
          "Right to Withdraw Consent: Withdraw consent where processing is based on consent",
          "Right to Restrict Processing: Request restriction of processing in certain circumstances",
          "Right to Object: Object to processing based on legitimate interests",
          "Right to Lodge a Complaint: File a complaint with the Nigeria Data Protection Commission or relevant authority"
        ]
      },
      {
        "type": "paragraph",
        "text": "To exercise these rights, contact us at privacy@vitalink.health. Some rights may be limited by legal requirements, particularly for medical records that must be retained for healthcare purposes."
      },
      {
        "type": "heading",
        "text": "12. Data Retention"
      },
      {
        "type": "paragraph",
        "text": "We retain your data in accordance with legal and healthcare requirements:"
      },
      {
        "type": "list",
        "items": [
          "Medical Records: Retained according to healthcare regulatory requirements (typically minimum of 10-20 years, or longer for certain conditions)",
          "Account Data: Retained while your account is active and for a reasonable period after closure",
          "Audit Logs: Retained for security and compliance purposes (typically 7 years)",
          "Marketing Data: Retained only while you have not opted out of marketing communications"
        ]
      },
      {
        "type": "paragraph",
        "text": "Data is securely deleted or anonymized when retention periods expire, unless longer retention is required by law."
      },
      {
        "type": "heading",
        "text": "13. Children's Privacy"
      },
      {
        "type": "paragraph",
        "text": "VitaLink services may be used by minors with parental or guardian consent. For children under 18:"
      },
      {
        "type": "list",
        "items": [
          "We require parental or guardian consent for creating accounts and processing personal data",
          "Parents and guardians have the right to access, review, and request deletion of their child's data",
          "We limit data collection from children to what is necessary for healthcare services",
          "We do not knowingly market to children or collect data for commercial purposes from minors"
        ]
      },
      {
        "type": "heading",
        "text": "14. International Transfers"
      },
      {
        "type": "paragraph",
        "text": "VitaLink primarily stores and processes data within Nigeria. However, we may transfer data internationally in the following circumstances:"
      },
      {
        "type": "list",
        "items": [
          "When you access services while traveling abroad",
          "When using cloud services with international data centers (with appropriate safeguards)",
          "When required for emergency medical care outside Nigeria",
          "When sharing with international health organizations for public health purposes (anonymized where required)"
        ]
      },
      {
        "type": "paragraph",
        "text": "All international transfers comply with NDPA requirements and include appropriate safeguards such as Standard Contractual Clauses or adequacy decisions where applicable."
      },
      {
        "type": "heading",
        "text": "15. Breach Notification"
      },
      {
        "type": "paragraph",
        "text": "In the event of a data security breach that poses a risk to your rights and freedoms:"
      },
      {
        "type": "list",
        "items": [
          "We will notify you within 72 hours of becoming aware of the breach, as required by NDPA",
          "Notification will include the nature of the breach, categories of data affected, and recommended actions",
          "We will also notify the Nigeria Data Protection Commission as required by law",
          "We will take immediate steps to contain the breach and mitigate any harm"
        ]
      },
      {
        "type": "heading",
        "text": "16. Contact Information"
      },
      {
        "type": "paragraph",
        "text": "For questions, concerns, or requests regarding this Privacy Policy or your personal data:"
      },
      {
        "type": "paragraph",
        "text": "Email: privacy@vitalink.africa"
      },
      {
        "type": "paragraph",
        "text": "Address: Lagos, Nigeria"
      },
      {
        "type": "paragraph",
        "text": "We will respond to your inquiry within 30 days as required by the NDPA."
      },
      {
        "type": "paragraph",
        "text": "By continuing to use VitaLink, you acknowledge and accept this Privacy Policy."
      }
    ]
  }
};
