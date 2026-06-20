import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaChevronLeft, FaEnvelope, FaLock, FaEye, FaEyeSlash, FaShieldAlt } from 'react-icons/fa';
import { verifyEmailOtpApi } from '../../api/authApi';
import { sendPasswordResetOtpApi } from '../../api/passwordResetApi';
import { supabase } from '../../lib/supabaseClient';
import './ResetPasswordPage.css';

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

const STEPS = [
  { key: 'email', label: '이메일' },
  { key: 'otp', label: '인증' },
  { key: 'password', label: '재설정' },
];

const DESCRIPTIONS = {
  email: '가입할 때 사용한 이메일을 입력해주세요. 비밀번호 변경을 위한 인증번호를 보내드립니다.',
  otp: '이메일로 받으신 6자리 인증번호를 입력해주세요.',
  password: '새로 사용할 비밀번호를 설정해주세요.',
};

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState('email'); // email, otp, password
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info'); // success, error, info
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);

  // 10분 만료 타이머
  useEffect(() => {
    if (timeLeft <= 0) return;
    const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // 재전송 60초 쿨다운 타이머
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const formatTime = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  const showMessage = (text, type = 'info') => {
    setMessage(text);
    setMessageType(type);
  };

  const handleSendOtp = async (isResend = false) => {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const normalizedEmail = email.trim();

    if (!normalizedEmail) { showMessage('이메일을 입력해주세요.', 'error'); return; }
    if (!emailRegex.test(normalizedEmail)) { showMessage('⚠️ 올바른 이메일 형식이 아닙니다.', 'error'); return; }

    setLoading(true);
    showMessage(isResend ? '인증번호 재발송 중...' : '인증번호 발송 중...', 'info');

    try {
      await sendPasswordResetOtpApi(normalizedEmail);

      setStep('otp');
      setOtpCode('');
      setTimeLeft(600);
      setResendCooldown(60);
      showMessage(isResend ? '✅ 인증번호를 다시 발송했습니다.' : '✅ 인증번호가 발송되었습니다.', 'success');
    } catch (err) {
      console.error('OTP 발송 실패:', { message: err.message, status: err.status, code: err.code });
      if (err.status === 429) {
        showMessage('인증번호를 너무 자주 요청했습니다. 잠시 후 다시 시도해주세요.', 'error');
      } else if (err.message === '가입되지 않은 이메일입니다.') {
        showMessage('가입되지 않은 이메일입니다.', 'error');
      } else {
        showMessage('인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) { showMessage('6자리 인증 코드를 입력해주세요.', 'error'); return; }
    if (timeLeft <= 0) {
      showMessage('인증번호가 만료되었습니다. 인증번호를 다시 발송해주세요.', 'error');
      return;
    }

    setLoading(true);
    showMessage('인증 코드 확인 중...', 'info');
    try {
      const result = await verifyEmailOtpApi(email.trim(), otpCode);

      if (!result?.session || !result?.user) {
        throw new Error('인증 세션이 생성되지 않았습니다.');
      }

      setTimeLeft(0);
      setStep('password');
      showMessage('✅ 인증이 완료되었습니다. 새 비밀번호를 입력해주세요.', 'success');
    } catch (err) {
      showMessage('❌ 인증번호가 올바르지 않거나 만료되었습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!passwordRegex.test(newPassword)) {
      showMessage('비밀번호는 8자 이상이며, 영문 대문자·소문자·숫자·특수문자(@$!%*?&)를 각각 1개 이상 포함해야 합니다.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showMessage('비밀번호가 일치하지 않습니다.', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('인증 시간이 만료되었습니다. 이메일 인증부터 다시 진행해주세요.');
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        console.error('비밀번호 변경 후 로그아웃 실패:', signOutError);
      }

      navigate('/login', {
        replace: true,
        state: { message: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.' },
      });
    } catch (err) {
      showMessage('❌ 비밀번호 변경 실패: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setStep('email');
    setOtpCode('');
    setTimeLeft(0);
    setResendCooldown(0);
    setMessage('');
  };

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="resetpw-page">
      <button
        type="button"
        className="resetpw-back-button"
        onClick={() => navigate('/login')}
        aria-label="로그인 화면으로 돌아가기"
      >
        <FaChevronLeft size={20} />
      </button>

      <h1 className="resetpw-title">비밀번호 재설정</h1>
      <p className="resetpw-description">{DESCRIPTIONS[step]}</p>

      <div className="resetpw-progress">
        {STEPS.map((s, i) => (
          <div
            key={s.key}
            className={`resetpw-progress-step ${i === currentStepIndex ? 'active' : ''} ${i < currentStepIndex ? 'completed' : ''}`}
          >
            <span className="resetpw-progress-dot" />
            {s.label}
          </div>
        ))}
      </div>

      {step === 'email' && (
        <div className="resetpw-field-group">
          <label className="resetpw-label">이메일</label>
          <div className="resetpw-input-wrapper">
            <FaEnvelope className="resetpw-icon" />
            <input
              type="email"
              placeholder="이메일을 입력해주세요"
              className="resetpw-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOtp(false)}
            />
          </div>
          <button
            type="button"
            className="resetpw-submit-button"
            onClick={() => handleSendOtp(false)}
            disabled={loading}
          >
            인증번호 발송
          </button>
        </div>
      )}

      {step === 'otp' && (
        <div className="resetpw-field-group">
          <label className="resetpw-label">인증번호</label>
          <div className="resetpw-input-wrapper">
            <FaShieldAlt className="resetpw-icon" />
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="6자리 인증번호"
              className="resetpw-input"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
            />
          </div>
          <p className="resetpw-timer">남은 시간 {formatTime(timeLeft)}</p>

          <button
            type="button"
            className="resetpw-submit-button"
            onClick={handleVerifyOtp}
            disabled={loading || otpCode.length !== 6 || timeLeft <= 0}
          >
            인증 확인
          </button>

          <div className="resetpw-link-row">
            <button
              type="button"
              className="resetpw-link-button"
              onClick={() => handleSendOtp(true)}
              disabled={loading || resendCooldown > 0}
            >
              {resendCooldown > 0 ? `재전송 (${resendCooldown}초)` : '인증번호 재전송'}
            </button>
            <button type="button" className="resetpw-link-button" onClick={resetState}>
              이메일 다시 입력
            </button>
          </div>
        </div>
      )}

      {step === 'password' && (
        <div className="resetpw-field-group">
          <label className="resetpw-label">새 비밀번호</label>
          <div className="resetpw-password-wrapper">
            <FaLock className="resetpw-icon" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="새 비밀번호 입력"
              className="resetpw-input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              type="button"
              className="resetpw-password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시하기'}
            >
              {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
            </button>
          </div>

          <label className="resetpw-label">새 비밀번호 확인</label>
          <div className="resetpw-password-wrapper">
            <FaLock className="resetpw-icon" />
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              placeholder="새 비밀번호 다시 입력"
              className="resetpw-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            <button
              type="button"
              className="resetpw-password-toggle"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? '비밀번호 숨기기' : '비밀번호 표시하기'}
            >
              {showConfirmPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
            </button>
          </div>
          <p className="resetpw-password-guide">
            8자 이상, 영문 대·소문자·숫자·특수문자(@$!%*?&) 각각 1개 이상 포함.
          </p>

          <button
            type="button"
            className="resetpw-submit-button"
            onClick={handleResetPassword}
            disabled={loading || !passwordRegex.test(newPassword) || newPassword !== confirmPassword}
          >
            비밀번호 변경
          </button>
        </div>
      )}

      {message && <div className={`message-area message-${messageType}`}>{message}</div>}
    </div>
  );
}

export default ResetPasswordPage;
