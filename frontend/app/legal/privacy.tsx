import React from "react";
import LegalPage from "../../src/components/LegalPage";

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="June 24, 2026"
      testID="privacy-screen"
      intro={'W ("we", "our", "us") respects your privacy. This policy explains what we collect, how we use it, and the choices you have.'}
      sections={[
        {
          heading: "Information We Collect",
          body: [
            "Account info: phone number, name, profile photo, and the @w.xyz handle you choose.",
            "Messages & email: chats, voice notes, photos and emails you send are stored so we can deliver them. We do not read or sell your messages.",
            "Device & log data: app version, OS, crash reports and basic usage events used to keep the service reliable.",
          ],
        },
        {
          heading: "How We Use Your Information",
          body: [
            "To operate W: authenticate you, deliver messages and email, sync between devices.",
            "To improve W: diagnose problems, prevent abuse, and develop new features.",
            "To communicate with you: send service notices, security alerts and reply to your support requests.",
          ],
        },
        {
          heading: "Third-Party Services",
          body: [
            "We use Twilio to send the SMS verification code to your phone number.",
            "We use SendGrid to deliver and receive email on your behalf at @w.xyz.",
            "We use Anthropic Claude to power the in-app W AI assistant — only messages you explicitly send to the assistant are processed.",
            "These providers handle data under their own privacy policies and only on our instructions.",
          ],
        },
        {
          heading: "Data Retention",
          body: "Your account data is kept while your account is active. Messages and emails remain until you delete them or close your account. You can request deletion of your account anytime through the in-app Help Center.",
        },
        {
          heading: "Your Choices & Rights",
          body: [
            "Access, update or delete your profile and content from within the app.",
            "Turn off notifications from Settings → Notifications.",
            "Request a copy or deletion of your data through the in-app Help Center. We respond within 30 days.",
          ],
        },
        {
          heading: "Security",
          body: "Data is transmitted over TLS and stored on encrypted infrastructure. We follow industry best practices, but no system can be guaranteed 100% secure.",
        },
        {
          heading: "Children",
          body: "W is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us data, reach us through the in-app Help Center.",
        },
        {
          heading: "Changes to This Policy",
          body: "We may update this policy from time to time. We will notify you of material changes in-app and update the \"Last updated\" date above.",
        },
        {
          heading: "Contact Us",
          body: "Questions about this policy? Reach us through the in-app Help Center.",
        },
      ]}
    />
  );
}
