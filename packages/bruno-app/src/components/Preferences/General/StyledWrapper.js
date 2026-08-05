import styled from 'styled-components';

const StyledWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  
  color: ${(props) => props.theme.text};

  .text-link {
    color: ${(props) => props.theme.colors.text.link};
    text-decoration: none;
    font-size: 0.8125rem;

    &:hover {
      text-decoration: underline;
    }
  }

  form.bruno-form {
    label {
      font-size: 0.8125rem;
    }
  }

  .default-location-input {
    max-width: 28rem;
  }

  .workspace-icon-preview {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    object-fit: cover;
    flex-shrink: 0;
  }

  .workspace-icon-preview-placeholder {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid ${(props) => props.theme.input.border};
    color: ${(props) => props.theme.colors.text.muted};
  }
`;

export default StyledWrapper;
