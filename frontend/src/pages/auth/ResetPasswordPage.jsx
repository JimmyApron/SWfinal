import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { verifyEmailOtpApi } from '../../api/authApi';
import { sendPasswordResetOtpApi } from '../../api/passwordResetApi';
import { supabase } from '../../lib/supabaseClient';

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState('email'); // email, otp, password
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
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

  const handleSendOtp = async (isResend = false) => {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const normalizedEmail = email.trim();

    if (!normalizedEmail) { setMessage('이메일을 입력해주세요.'); return; }
    if (!emailRegex.test(normalizedEmail)) { setMessage('⚠️ 올바른 이메일 형식이 아닙니다.'); return; }

    setLoading(true);
    setMessage(isResend ? '인증번호 재발송 중...' : '인증번호 발송 중...');
    
    try {
      await sendPasswordResetOtpApi(normalizedEmail);

      setStep('otp');
      setOtpCode('');
      setTimeLeft(600);
      setResendCooldown(60);
      setMessage(isResend ? '✅ 인증번호를 다시 발송했습니다.' : '✅ 인증번호가 발송되었습니다.');
    } catch (err) {
      console.error('OTP 발송 실패:', { message: err.message, status: err.status, code: err.code });
      if (err.status === 429) {
        setMessage('인증번호를 너무 자주 요청했습니다. 잠시 후 다시 시도해주세요.');
      } else if (err.message === '가입되지 않은 이메일입니다.') {
        setMessage('가입되지 않은 이메일입니다.');
      } else {
        setMessage('인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) { setMessage('6자리 인증 코드를 입력해주세요.'); return; }
    if (timeLeft <= 0) {
      setMessage('인증번호가 만료되었습니다. 인증번호를 다시 발송해주세요.');
      return;
    }

    setLoading(true);
    setMessage('인증 코드 확인 중...');
    try {
      const result = await verifyEmailOtpApi(email.trim(), otpCode);
      
      if (!result?.session || !result?.user) {
        throw new Error('인증 세션이 생성되지 않았습니다.');
      }

      setTimeLeft(0);
      setStep('password');
      setMessage('✅ 인증이 완료되었습니다. 새 비밀번호를 입력해주세요.');
    } catch (err) {
      setMessage('❌ 인증번호가 올바르지 않거나 만료되었습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!passwordRegex.test(newPassword)) {
      setMessage('비밀번호는 8자 이상이며, 영문 대문자·소문자·숫자·특수문자(@$!%*?&)를 각각 1개 이상 포함해야 합니다.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('비밀번호가 일치하지 않습니다.');
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
      setMessage('❌ 비밀번호 변경 실패: ' + err.message);
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

  return (
    <div className="auth-container">
      <h2>비밀번호 재설정</h2>
      
      {step === 'email' && (
        <>
          <p>가입할 때 사용한 이메일을 입력해주세요. 비밀번호 변경을 위한 인증번호를 보내드립니다.</p>
          <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="button" onClick={() => handleSendOtp(false)} disabled={loading}>인증번호 발송</button>
        </>
      )}

      {step === 'otp' && (
        <>
          <p>이메일로 받으신 6자리 인증번호를 입력해주세요.</p>
          <input type="text" inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="6자리 인증번호" value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <p>남은 시간: {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}</p>
          <button type="button" onClick={handleVerifyOtp} disabled={loading || otpCode.length !== 6 || timeLeft <= 0}>인증 확인</button>
          <button type="button" onClick={() => handleSendOtp(true)} disabled={loading || resendCooldown > 0}>
            {resendCooldown > 0 ? `재전송 가능 (${resendCooldown}초)` : '인증번호 재전송'}
          </button>
          <button type="button" onClick={resetState}>이메일 다시 입력</button>
        </>
      )}

      {step === 'password' && (
        <>
          <input type="password" placeholder="새 비밀번호" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <input type="password" placeholder="새 비밀번호 확인" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          <p style={{ fontSize: '12px', color: '#666' }}>
            8자 이상, 영문 대문자·소문자·숫자·특수문자(@$!%*?&) 각각 1개 이상 포함.
          </p>
          <button 
            type="button" 
            onClick={handleResetPassword} 
            disabled={loading || !passwordRegex.test(newPassword) || newPassword !== confirmPassword}
          >
            비밀번호 변경
          </button>
        </>
      )}

      {message && <p>{message}</p>}
    </div>
  );
}

export default ResetPasswordPage;
