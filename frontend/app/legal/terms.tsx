import React from "react";
import LegalPage from "../../src/components/LegalPage";

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="June 24, 2026"
      testID="terms-screen"
      intro="Welcome to W. By creating an account or using the app, you agree to these Terms. Please read them carefully."
      sections={[
        {
          heading: "Eligibility",
          body: "You must be at least 13 years old (or the minimum age in your country) and able to form a binding contract to use W.",
        },
        {
          heading: "Your Account",
          body: [
            "You are responsible for keeping your phone number, OTP codes and device secure.",
            "You agree to provide accurate information and to keep it up to date.",
            "Your @w.xyz handle is yours while your account is active. W reserves the right to deny, reclaim, or retract any handle at any time — including after sign up — when a handle is inactive, impersonates another person or organization, infringes a trademark, contains profanity or slurs, or is otherwise reserved (e.g. admin, support, well-known stage names). To request a reserved handle, reach us through the in-app Help Center; release may require a premium subscription.",
          ],
        },
        {
          heading: "Acceptable Use",
          body: [
            "Do not use W to send spam, phishing, harassing, hateful, illegal or sexually explicit content involving minors.",
            "Do not attempt to break, abuse, reverse-engineer, or overwhelm the service.",
            "Do not impersonate others or misrepresent your identity.",
            "We may suspend or terminate accounts that violate these rules.",
          ],
        },
        {
          heading: "Your Content",
          body: "You own what you send through W. By using the service you grant us the limited right to store and transmit your content so we can deliver it to the people you choose.",
        },
        {
          heading: "AI Assistant",
          body: "Messages you send to the W AI assistant are processed by a third-party model provider to generate responses. The assistant may produce inaccurate information — verify important answers independently.",
        },
        {
          heading: "Email Service",
          body: "@w.xyz email is provided as part of W. You agree not to use it for unsolicited bulk email or any activity that would harm the deliverability or reputation of the W domain.",
        },
        {
          heading: "Service Availability",
          body: "W is provided on an \"as is\" basis. We work hard to keep it running, but we don't guarantee uninterrupted or error-free service.",
        },
        {
          heading: "Termination",
          body: "You can delete your account anytime from Settings or through the in-app Help Center. We may suspend or terminate accounts that violate these Terms.",
        },
        {
          heading: "Limitation of Liability",
          body: "To the maximum extent permitted by law, W and its operators are not liable for indirect, incidental, special or consequential damages arising from your use of the service.",
        },
        {
          heading: "Changes to These Terms",
          body: "We may update these Terms. Continued use of W after changes take effect means you accept the updated Terms.",
        },
        {
          heading: "Contact Us",
          body: "Questions about these Terms? Reach us through the in-app Help Center.",
        },
      ]}
    />
  );
}
