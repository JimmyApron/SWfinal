import React, { useState, useEffect, useRef } from 'react';
import { sendEmailOtpApi, verifyEmailOtpApi, signupApi, checkNicknameDuplicateApi, checkEmailDuplicateApi } from '../../api/authApi';
import { FaEye, FaEyeSlash, FaChevronLeft, FaEnvelope, FaUser, FaLock } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabaseClient';
import './SignupPage.css';

function SignupPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [isEmailChecked, setIsEmailChecked] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  const [nickname, setNickname] = useState('');
  const [isNicknameChecked, setIsNicknameChecked] = useState(false);

  const [password, setPassword] = useState('');
  const [passwordCheck, setPasswordCheck] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordCheck, setShowPasswordCheck] = useState(false);

  const [fieldMessages, setFieldMessages] = useState({
    email: null,
    nickname: null,
    password: null,
    passwordCheck: null,
    form: null,
  });
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);

  const setFieldMessage = (field, text, type = 'info') => {
    setFieldMessages((prev) => ({
      ...prev,
      [field]: text ? { text, type } : null,
    }));
  };

  const clearFieldMessage = (field) => {
    setFieldMessages((prev) => ({ ...prev, [field]: null }));
  };

  const clearFormMessage = () => clearFieldMessage('form');

  useEffect(() => {
    if (!otpSent || emailVerified) return;
    setTimeLeft(600);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [otpSent, emailVerified]);

  const formatTime = (seconds) => {
    const m = String(Math.floor(seconds / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    setIsEmailChecked(false);
    setOtpSent(false);
    setEmailVerified(false);
    setOtpCode('');
    clearFieldMessage('email');
    clearFormMessage();
  };

  const handleCheckEmail = async () => {
    if (!email) { setFieldMessage('email', '이메일을 입력해주세요.', 'error'); return; }
    if (!emailRegex.test(email)) { setFieldMessage('email', '올바른 이메일 형식이 아닙니다.', 'error'); return; }
    setLoading(true);
    setFieldMessage('email', '중복 확인 중...', 'info');
    clearFormMessage();
    try {
      const isDuplicate = await checkEmailDuplicateApi(email.trim());
      if (isDuplicate) {
        setIsEmailChecked(false);
        setFieldMessage('email', '이미 사용 중인 이메일입니다.', 'error');
      } else {
        setIsEmailChecked(true);
        setFieldMessage('email', '사용 가능한 이메일입니다.', 'success');
      }
    } catch (error) {
      setIsEmailChecked(false);
      setFieldMessage('email', '중복 확인 실패: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!isEmailChecked) { setFieldMessage('email', '먼저 이메일 중복 확인을 해주세요.', 'error'); return; }
    setLoading(true);
    setFieldMessage('email', '인증 코드 전송 중...', 'info');
    clearFormMessage();
    try {
      await sendEmailOtpApi(email.trim());
      setOtpSent(true);
      setFieldMessage('email', '인증 코드를 이메일로 전송했습니다.', 'success');
    } catch (error) {if (error.status === 429 || error.message?.includes('rate limit') || error.message?.includes('429')) {
        setFieldMessage('email', '인증 코드 요청이 너무 많습니다. 1~5분 후 다시 시도해주세요.', 'error')
      } else if (error.message === '이미 사용 중인 이메일입니다.') {
        setFieldMessage('email', '이미 사용 중인 이메일입니다.', 'error')
      } else {
        setFieldMessage('email', '인증 코드 전송 실패: ' + (error.message || '잠시 후 다시 시도해주세요.'), 'error')
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length !== 6) { setFieldMessage('email', '6자리 인증 코드를 입력해주세요.', 'error'); return; }
    if (timeLeft === 0) { setFieldMessage('email', '인증 코드가 만료되었습니다. 재전송 버튼을 눌러주세요.', 'error'); return; }

    setLoading(true);
    setFieldMessage('email', '인증 코드 확인 중...', 'info');
    clearFormMessage();
    try {
      await verifyEmailOtpApi(email.trim(), otpCode);
      setEmailVerified(true);
      setOtpSent(false);
      setFieldMessage('email', '이메일 인증이 완료되었습니다.', 'success');
    } catch (error) {
      setFieldMessage('email', '인증 코드가 올바르지 않습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleNicknameCheck = async (e) => {
    e.preventDefault();
    if (!nickname) { setFieldMessage('nickname', '닉네임을 입력한 후 중복 확인을 해주세요.', 'error'); return; }

    try {
      setFieldMessage('nickname', '닉네임 중복 확인 중입니다...', 'info');
      clearFormMessage();
      const isDuplicate = await checkNicknameDuplicateApi(nickname.trim());
      if (isDuplicate) {
        setIsNicknameChecked(false);
        setFieldMessage('nickname', '이미 사용 중인 닉네임입니다.', 'error');
      } else {
        setIsNicknameChecked(true);
        setFieldMessage('nickname', '사용 가능한 닉네임입니다.', 'success');
      }
    } catch (error) {
      setFieldMessage('nickname', '닉네임 중복 체크에 실패했습니다.', 'error');
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();

    if (!emailVerified) { setFieldMessage('email', '이메일 인증을 완료해주세요.', 'error'); return; }
    if (!isNicknameChecked) { setFieldMessage('nickname', '닉네임 중복 확인을 완료해주세요.', 'error'); return; }
    if (!passwordRegex.test(password)) {
      setFieldMessage('password', '비밀번호는 영문 대/소문자, 숫자, 특수문자를 모두 포함하여 최소 8자 이상이어야 합니다.', 'error');
      return;
    }
    if (password !== passwordCheck) { setFieldMessage('passwordCheck', '비밀번호가 서로 다릅니다.', 'error'); return; }

    try {
      setLoading(true);
      setFieldMessage('form', '회원가입 중입니다...', 'info');
      await signupApi({ password, nickname: nickname.trim() });
      await supabase.auth.signOut();
      setFieldMessage('form', '회원가입이 완료되었습니다. 로그인 페이지로 이동합니다.', 'success');
      setTimeout(() => navigate('/login'), 2000);
    } catch (error) {


      setFieldMessage('form', error.message || '회원가입에 실패했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-page">
      <section className="signup-card">
        <button type="button" className="signup-back-button" onClick={() => navigate('/')} aria-label="메인 화면으로 돌아가기">
          <FaChevronLeft size={20} />
        </button>

        <h1 className="signup-title">회원가입</h1>
        <p className="signup-description">이메일과 닉네임을 입력하고 계정을 만들어보세요.</p>

        <form onSubmit={handleSignup} className="signup-form">
          {/* 이메일 */}
          <div className="signup-field-group">
            <label className="signup-label">이메일</label>
            <div className="signup-input-wrapper">
              <div style={{ position: 'relative', flex: 1 }}>
                <FaEnvelope className="signup-icon" />
                <input type="email" placeholder="이메일 입력" className="signup-input" value={email} onChange={handleEmailChange} disabled={emailVerified} aria-label="이메일" />
              </div>
              <button type="button" onClick={handleCheckEmail} disabled={loading || emailVerified} className="signup-check-button" aria-label="이메일 중복 확인">
                {emailVerified ? '인증완료' : '중복 확인'}
              </button>
            </div>
            {fieldMessages.email && (
              <p className={`signup-field-message message-${fieldMessages.email.type}`}>
                {fieldMessages.email.text}
              </p>
            )}

            {isEmailChecked && !emailVerified && (
              <button type="button" onClick={handleSendOtp} disabled={loading} className="signup-submit-button">
                {otpSent ? '인증 코드 재전송' : '인증번호 발송'}
              </button>
            )}

            {otpSent && !emailVerified && (
              <div style={{ marginTop: '10px' }}>
                <div className="signup-input-wrapper">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    placeholder="인증 코드 6자리"
                    className="signup-input"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    aria-label="인증 코드"
                  />
                  <button type="button" className="signup-check-button" onClick={handleVerifyOtp} disabled={loading}>확인 ({formatTime(timeLeft)})</button>
                </div>
                {timeLeft === 0 && (
                  <p style={{ fontSize: '12px', color: '#e53935', textAlign: 'center', marginTop: '5px' }}>
                    인증 코드가 만료되었습니다. 재전송 버튼을 눌러주세요.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 닉네임 */}
          <div className="signup-field-group">
            <label className="signup-label">닉네임</label>
            <div className="signup-input-wrapper">
              <div style={{ position: 'relative', flex: 1 }}>
                <FaUser className="signup-icon" />
                <input type="text" placeholder="닉네임 입력" className="signup-input" value={nickname} onChange={(e) => { setNickname(e.target.value); setIsNicknameChecked(false); clearFieldMessage('nickname'); }} disabled={!emailVerified} aria-label="닉네임" />
              </div>
              <button type="button" className="signup-check-button" onClick={handleNicknameCheck} disabled={!emailVerified || loading} aria-label="닉네임 중복 확인">
                중복 확인
              </button>
            </div>
            {fieldMessages.nickname && (
              <p className={`signup-field-message message-${fieldMessages.nickname.type}`}>
                {fieldMessages.nickname.text}
              </p>
            )}
          </div>

          {/* 비밀번호 */}
          <div className="signup-field-group">
            <label className="signup-label">비밀번호</label>
            <div className="signup-password-wrapper">
              <FaLock className="signup-icon" />
              <input type={showPassword ? 'text' : 'password'} placeholder="비밀번호 입력" className="signup-input" value={password} onChange={(e) => { setPassword(e.target.value); clearFieldMessage('password'); }} disabled={!emailVerified} aria-label="비밀번호" />
              <button type="button" className="signup-password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시하기'}>
                {showPassword ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
              </button>
            </div>
            {fieldMessages.password && (
              <p className={`signup-field-message message-${fieldMessages.password.type}`}>
                {fieldMessages.password.text}
              </p>
            )}
          </div>

          {/* 비밀번호 확인 */}
          <div className="signup-field-group">
            <label className="signup-label">비밀번호 확인</label>
            <div className="signup-password-wrapper">
              <FaLock className="signup-icon" />
              <input type={showPasswordCheck ? 'text' : 'password'} placeholder="비밀번호 재입력" className="signup-input" value={passwordCheck} onChange={(e) => { setPasswordCheck(e.target.value); clearFieldMessage('passwordCheck'); }} disabled={!emailVerified} aria-label="비밀번호 확인" />
              <button type="button" className="signup-password-toggle" onClick={() => setShowPasswordCheck(!showPasswordCheck)} aria-label={showPasswordCheck ? '비밀번호 숨기기' : '비밀번호 표시하기'}>
                {showPasswordCheck ? <FaEyeSlash size={18} /> : <FaEye size={18} />}
              </button>
            </div>
            {fieldMessages.passwordCheck && (
              <p className={`signup-field-message message-${fieldMessages.passwordCheck.type}`}>
                {fieldMessages.passwordCheck.text}
              </p>
            )}
            <p className="signup-password-guide">8자 이상, 영문 대·소문자·숫자·특수문자(@$!%*?&) 포함.</p>
          </div>

          {fieldMessages.form && (
            <div className={`message-area message-${fieldMessages.form.type}`}>
              {fieldMessages.form.text}
            </div>
          )}
          <button type="submit" className="signup-submit-button" disabled={!emailVerified || !isNicknameChecked || loading}>회원가입 완료하기</button>
        </form>

        <div className="signup-login-row">
          <span>이미 계정이 있으신가요?</span>
          <button type="button" className="signup-login-link" onClick={() => navigate('/login')}>로그인</button>
        </div>
      </section>
    </div>
  );
}

export default SignupPage;
